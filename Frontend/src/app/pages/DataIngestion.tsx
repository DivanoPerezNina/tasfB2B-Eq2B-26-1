/**
 * DataIngestion — Ingreso de datos maestros (aeropuertos, vuelos, envíos,
 * cancelaciones). Pantalla independiente de los escenarios.
 *
 * Migrada a Carbon Design System.
 *   POST /api/carga/upload/{kind}   (campo multipart "archivo")
 *   GET  /api/carga/plantillas/{kind}
 *   DELETE /api/carga/upload/cancelaciones
 */
import React, { useEffect, useState } from 'react';
import {
  Tile, Button, Checkbox, InlineNotification, Stack, Link,
  FileUploaderDropContainer, FileUploaderItem,
} from '@carbon/react';
import { Location, Plane, Box, CloseOutline, Upload, Download, TrashCan } from '@carbon/icons-react';
import { toast } from 'sonner';

const BFF = import.meta.env.VITE_BFF_URL ?? '';

type UploadKind = 'aeropuertos' | 'vuelos' | 'envios' | 'cancelaciones';
type UploadState = 'idle' | 'subiendo' | 'ok' | 'error';

interface DatasetInfo {
  fecha_min: string;
  fecha_max: string;
  total_envios: string;
}

export function DataIngestion() {
  const [dataset, setDataset]   = useState<DatasetInfo | null>(null);
  const [forzar, setForzar]     = useState(false);

  const [aeroFile,   setAeroFile]   = useState<File | null>(null);
  const [vuelosFile, setVuelosFile] = useState<File | null>(null);
  const [enviosFiles, setEnviosFiles] = useState<File[]>([]);
  const [cancelFile, setCancelFile] = useState<File | null>(null);

  const [estado, setEstado] = useState<Record<UploadKind, UploadState>>({
    aeropuertos: 'idle', vuelos: 'idle', envios: 'idle', cancelaciones: 'idle',
  });
  const [mensaje, setMensaje] = useState<Record<UploadKind, string>>({
    aeropuertos: '', vuelos: '', envios: '', cancelaciones: '',
  });

  const cargarDataset = () => {
    fetch(`${BFF}/api/dataset`)
      .then(r => r.json())
      .then(json => {
        const d = json.data ?? json;
        if (d?.fecha_min) {
          setDataset({
            fecha_min: d.fecha_min.slice(0, 10),
            fecha_max: d.fecha_max.slice(0, 10),
            total_envios: d.total_envios,
          });
        }
      })
      .catch(() => { /* backend puede no estar arriba */ });
  };
  useEffect(cargarDataset, []);

  const subirArchivo = async (kind: UploadKind, file: File): Promise<boolean> => {
    const fd = new FormData();
    fd.append('archivo', file);
    const url = `${BFF}/api/carga/upload/${kind}${forzar ? '?forzar=true' : ''}`;
    const res = await fetch(url, { method: 'POST', body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.mensaje ?? json.error ?? `HTTP ${res.status}`);
    }
    return true;
  };

  const filesFor = (kind: UploadKind): File[] => {
    if (kind === 'envios') return enviosFiles;
    if (kind === 'aeropuertos') return aeroFile ? [aeroFile] : [];
    if (kind === 'vuelos') return vuelosFile ? [vuelosFile] : [];
    return cancelFile ? [cancelFile] : [];
  };

  const handleSubir = async (kind: UploadKind) => {
    const files = filesFor(kind);
    if (files.length === 0) { toast.error('Selecciona al menos un archivo'); return; }
    setEstado(prev => ({ ...prev, [kind]: 'subiendo' }));
    setMensaje(prev => ({ ...prev, [kind]: '' }));
    try {
      let n = 0;
      for (const f of files) {
        await subirArchivo(kind, f);
        n++;
        setMensaje(prev => ({ ...prev, [kind]: `${n}/${files.length} archivos subidos…` }));
      }
      setEstado(prev => ({ ...prev, [kind]: 'ok' }));
      setMensaje(prev => ({ ...prev, [kind]: `${n} archivo(s) cargado(s) correctamente` }));
      toast.success(`${kind} cargado`, { description: `${n} archivo(s) procesado(s)` });
      cargarDataset();
    } catch (e: any) {
      setEstado(prev => ({ ...prev, [kind]: 'error' }));
      setMensaje(prev => ({ ...prev, [kind]: e.message ?? 'Error al subir' }));
      toast.error(`Error al cargar ${kind}`, { description: e.message });
    }
  };

  const [limpiando, setLimpiando] = useState(false);
  const handleLimpiarCancelaciones = async () => {
    setLimpiando(true);
    try {
      const res = await fetch(`${BFF}/api/carga/upload/cancelaciones`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setCancelFile(null);
      setEstado(prev => ({ ...prev, cancelaciones: 'idle' }));
      setMensaje(prev => ({ ...prev, cancelaciones: '' }));
      toast.success('Cancelaciones limpiadas');
    } catch (e: any) {
      toast.error('No se pudo limpiar', { description: e.message });
    } finally {
      setLimpiando(false);
    }
  };

  const cards: {
    kind: UploadKind; label: string; hint: string; icon: React.ReactNode;
    multiple: boolean; accept: string; clearable?: boolean; selected: File[];
    onPick: (files: File[]) => void; onClear: () => void;
  }[] = [
    {
      kind: 'aeropuertos', label: 'Aeropuertos', hint: 'aeropuertos.txt',
      icon: <Location size={20} />, multiple: false, accept: '.txt',
      selected: aeroFile ? [aeroFile] : [], onPick: (f) => setAeroFile(f[0] ?? null), onClear: () => setAeroFile(null),
    },
    {
      kind: 'vuelos', label: 'Vuelos', hint: 'vuelos.txt',
      icon: <Plane size={20} />, multiple: false, accept: '.txt',
      selected: vuelosFile ? [vuelosFile] : [], onPick: (f) => setVuelosFile(f[0] ?? null), onClear: () => setVuelosFile(null),
    },
    {
      kind: 'envios', label: 'Envíos', hint: '_envios_XXXX_.txt (uno por aeropuerto)',
      icon: <Box size={20} />, multiple: true, accept: '.txt',
      selected: enviosFiles, onPick: (f) => setEnviosFiles(f), onClear: () => setEnviosFiles([]),
    },
    {
      kind: 'cancelaciones', label: 'Cancelaciones', hint: 'cancelaciones.csv · ruta + fecha/hora local',
      icon: <CloseOutline size={20} />, multiple: false, accept: '.csv,.txt', clearable: true,
      selected: cancelFile ? [cancelFile] : [], onPick: (f) => setCancelFile(f[0] ?? null), onClear: () => setCancelFile(null),
    },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--cds-background)' }}>
      <div style={{ maxWidth: '76rem', margin: '0 auto', padding: '2rem 1.5rem' }}>
        <Stack gap={6}>

          {/* Encabezado */}
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 400, margin: 0 }}>Ingreso de datos</h1>
            <p style={{ color: 'var(--cds-text-secondary)', margin: '.25rem 0 0' }}>
              Carga de aeropuertos, vuelos, envíos y cancelaciones (independiente de los escenarios)
            </p>
          </div>

          {/* Estado del dataset */}
          {dataset ? (
            <InlineNotification
              kind="success" lowContrast hideCloseButton
              title="Datos disponibles"
              subtitle={`${Number(dataset.total_envios).toLocaleString()} envíos · ${dataset.fecha_min} → ${dataset.fecha_max}`}
            />
          ) : (
            <InlineNotification
              kind="warning" lowContrast hideCloseButton
              title="Sin datos"
              subtitle="No hay datos cargados o el backend no está disponible."
            />
          )}

          {/* Forzar */}
          <Checkbox
            id="forzar"
            labelText="Sobreescribir datos existentes (forzar)"
            checked={forzar}
            onChange={(_, { checked }: { checked: boolean }) => setForzar(checked)}
          />

          {/* Tarjetas */}
          <div style={{
            display: 'grid', gap: '1rem',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          }}>
            {cards.map((c) => {
              const st = estado[c.kind];
              return (
                <Tile key={c.kind}>
                  <Stack gap={4}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      {c.icon}
                      <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{c.label}</h2>
                    </div>
                    <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0, minHeight: '2rem' }}>
                      {c.hint}
                    </p>

                    <FileUploaderDropContainer
                      labelText={c.multiple ? 'Arrastra o elige archivos' : 'Arrastra o elige un archivo'}
                      accept={c.accept.split(',')}
                      multiple={c.multiple}
                      onAddFiles={(_e: unknown, { addedFiles }: { addedFiles: File[] }) => c.onPick(addedFiles)}
                    />

                    {c.selected.map((f) => (
                      <FileUploaderItem
                        key={f.name}
                        name={f.name}
                        status={st === 'ok' ? 'complete' : 'edit'}
                        onDelete={c.onClear}
                      />
                    ))}

                    <Button
                      size="sm"
                      renderIcon={Upload}
                      disabled={c.selected.length === 0 || st === 'subiendo'}
                      onClick={() => handleSubir(c.kind)}
                    >
                      {st === 'subiendo' ? 'Subiendo…' : 'Subir'}
                    </Button>

                    {mensaje[c.kind] && (
                      <InlineNotification
                        kind={st === 'ok' ? 'success' : st === 'error' ? 'error' : 'info'}
                        lowContrast hideCloseButton
                        title={st === 'error' ? 'Error' : st === 'ok' ? 'Listo' : 'Estado'}
                        subtitle={mensaje[c.kind]}
                      />
                    )}

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      <Link href={`${BFF}/api/carga/plantillas/${c.kind}`} renderIcon={Download} size="sm">
                        Plantilla
                      </Link>
                      {c.clearable && (
                        <Link
                          as="button" size="sm" renderIcon={TrashCan}
                          disabled={limpiando}
                          onClick={handleLimpiarCancelaciones}
                          style={{ color: 'var(--cds-text-error)', cursor: 'pointer', background: 'none', border: 0 }}
                        >
                          {limpiando ? 'Limpiando…' : 'Limpiar'}
                        </Link>
                      )}
                    </div>
                  </Stack>
                </Tile>
              );
            })}
          </div>

          <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
            Orden recomendado: <strong>aeropuertos</strong> → <strong>vuelos</strong> → <strong>envíos</strong>.
            Las cancelaciones aplican a Periodo/Colapso y son efímeras por escenario.
          </p>
        </Stack>
      </div>
    </div>
  );
}

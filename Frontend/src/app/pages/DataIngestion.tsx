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
import { authHeader } from '../lib/auth';

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
        if (d && d.total_envios !== undefined && d.total_envios !== null) {
          setDataset({
            fecha_min: d.fecha_min ? String(d.fecha_min).slice(0, 10) : '',
            fecha_max: d.fecha_max ? String(d.fecha_max).slice(0, 10) : '',
            total_envios: String(d.total_envios),
          });
        } else {
          setDataset(null);
        }
      })
      .catch(() => { /* backend puede no estar arriba */ });
  };
  useEffect(cargarDataset, []);

  interface EstadoCarga {
    token: string;
    estado: 'recibido' | 'procesando' | 'ok' | 'error';
    registros_total: number;
    registros_ok: number;
    detalle_error?: string;
  }

  const esperarProcesamiento = async (
    token: string,
    kind: UploadKind,
    fileName: string,
  ): Promise<EstadoCarga> => {
    const limiteMs = 4 * 60 * 60 * 1000;
    const inicio = Date.now();

    while (Date.now() - inicio < limiteMs) {
      const res = await fetch(`${BFF}/api/carga/upload/sesion/${token}`, {
        headers: authHeader(),
        cache: 'no-store',
      });
      const estado: EstadoCarga = await res.json();
      if (!res.ok) {
        throw new Error(estado.detalle_error ?? `No se pudo consultar la carga: HTTP ${res.status}`);
      }

      if (estado.estado === 'error') {
        throw new Error(estado.detalle_error || `Falló el procesamiento de ${fileName}`);
      }
      if (estado.estado === 'ok') {
        return estado;
      }

      setMensaje(prev => ({
        ...prev,
        [kind]: `${fileName}: procesando ${Number(estado.registros_total || 0).toLocaleString()} registros · ${Number(estado.registros_ok || 0).toLocaleString()} insertados`,
      }));
      await new Promise(resolve => window.setTimeout(resolve, 2000));
    }

    throw new Error(`La carga de ${fileName} continúa demasiado tiempo. Revisa carga_sesiones y logs/carga-masiva.log.`);
  };

  const subirArchivo = async (kind: UploadKind, file: File): Promise<EstadoCarga> => {
    const fd = new FormData();
    fd.append('archivo', file);
    const url = `${BFF}/api/carga/upload/${kind}${forzar ? '?forzar=true' : ''}`;
    const res = await fetch(url, { method: 'POST', headers: authHeader(), body: fd });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.mensaje ?? json.error ?? `HTTP ${res.status}`);
    }
    if (!json.token) {
      throw new Error('El backend recibió el archivo, pero no devolvió el token de procesamiento.');
    }
    return esperarProcesamiento(json.token, kind, file.name);
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
      let totalInsertados = 0;
      for (const f of files) {
        setMensaje(prev => ({ ...prev, [kind]: `${f.name}: archivo recibido; esperando inserción en la BD…` }));
        const resultado = await subirArchivo(kind, f);
        n++;
        totalInsertados += Number(resultado.registros_ok || 0);
        setMensaje(prev => ({
          ...prev,
          [kind]: `${n}/${files.length} completados · ${totalInsertados.toLocaleString()} registros nuevos insertados`,
        }));
        cargarDataset();
      }
      setEstado(prev => ({ ...prev, [kind]: 'ok' }));
      setMensaje(prev => ({
        ...prev,
        [kind]: `${n} archivo(s) procesado(s) · ${totalInsertados.toLocaleString()} registros nuevos insertados`,
      }));
      toast.success(`${kind} cargado`, { description: `${totalInsertados.toLocaleString()} registros insertados` });
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
      const res = await fetch(`${BFF}/api/carga/upload/cancelaciones`, { method: 'DELETE', headers: authHeader() });
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
      kind: 'envios', label: 'Envíos Periodo/Colapso', hint: '_envios_XXXX_.txt → envios · hasta 31/03/2027',
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
              Carga de aeropuertos, vuelos, envíos para Periodo/Colapso y cancelaciones
            </p>
          </div>

          {/* Estado del dataset */}
          {dataset ? (
            <InlineNotification
              kind={Number(dataset.total_envios) > 0 ? 'success' : 'warning'}
              lowContrast hideCloseButton
              title={Number(dataset.total_envios) > 0 ? 'Datos disponibles' : 'Tabla envios vacía'}
              subtitle={
                Number(dataset.total_envios) > 0
                  ? `${Number(dataset.total_envios).toLocaleString()} envíos · ${dataset.fecha_min} → ${dataset.fecha_max}`
                  : '0 envíos · carga los archivos _envios_XXXX_.txt'
              }
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
                <Tile key={c.kind} style={{ height: '100%' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
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

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '.5rem' }}>
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
                  </div>
                </Tile>
              );
            })}
          </div>

          <p style={{ fontSize: '.75rem', color: 'var(--cds-text-secondary)', margin: 0 }}>
            Orden recomendado: <strong>aeropuertos</strong> → <strong>vuelos</strong> → <strong>envíos</strong>.
            Los envíos de Periodo y Colapso se guardan en envios. Día a Día continúa usando envios_operacion.
          </p>
        </Stack>
      </div>
    </div>
  );
}

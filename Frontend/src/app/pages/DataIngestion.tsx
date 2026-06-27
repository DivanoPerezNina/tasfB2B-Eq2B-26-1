/**
 * DataIngestion — Ingreso de datos maestros (aeropuertos, vuelos, envíos).
 *
 * Pantalla SEPARADA de los 3 escenarios de simulación, según requerimiento del
 * curso: "todo ingreso de datos (distinto al registro de maletas) debe estar en
 * una opción de menú distinta a la de los 3 escenarios".
 *
 * Sube los archivos .txt al servicio de Carga Masiva vía el BFF:
 *   POST /api/carga/upload/aeropuertos  (campo multipart "archivo")
 *   POST /api/carga/upload/vuelos
 *   POST /api/carga/upload/envios       (un archivo por aeropuerto: _envios_XXXX_.txt)
 */
import React, { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/label';
import {
  Database, Upload, FileSpreadsheet, CheckCircle2, AlertCircle,
  Plane, MapPin, Package, Loader2, X,
} from 'lucide-react';
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

  // Sube un único archivo a /api/carga/upload/{kind}
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
    if (files.length === 0) {
      toast.error('Selecciona al menos un archivo');
      return;
    }
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

  const cards: {
    kind: UploadKind; label: string; hint: string; icon: React.ReactNode;
    multiple: boolean; accept: string; file: File | null; files: File[];
    onPick: (files: FileList | null) => void;
  }[] = [
    {
      kind: 'aeropuertos', label: 'Aeropuertos', hint: 'aeropuertos.txt',
      icon: <MapPin className="h-5 w-5" />, multiple: false, accept: '.txt',
      file: aeroFile, files: [],
      onPick: (fl) => setAeroFile(fl?.[0] ?? null),
    },
    {
      kind: 'vuelos', label: 'Vuelos', hint: 'vuelos.txt',
      icon: <Plane className="h-5 w-5" />, multiple: false, accept: '.txt',
      file: vuelosFile, files: [],
      onPick: (fl) => setVuelosFile(fl?.[0] ?? null),
    },
    {
      kind: 'envios', label: 'Envíos', hint: '_envios_XXXX_.txt (uno por aeropuerto)',
      icon: <Package className="h-5 w-5" />, multiple: true, accept: '.txt',
      file: null, files: enviosFiles,
      onPick: (fl) => setEnviosFiles(fl ? Array.from(fl) : []),
    },
    {
      kind: 'cancelaciones', label: 'Cancelaciones', hint: 'cancelaciones.csv (ruta + fecha/hora local)',
      icon: <X className="h-5 w-5" />, multiple: false, accept: '.csv,.txt',
      file: cancelFile, files: [],
      onPick: (fl) => setCancelFile(fl?.[0] ?? null),
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="border-b border-panel-border bg-panel-bg px-6 py-3 shadow-sm">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-bold text-panel-text">Ingreso de datos</h2>
            <p className="text-xs text-panel-text-faint">
              Carga de aeropuertos, vuelos y envíos al sistema (independiente de los escenarios)
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl space-y-5 p-6">
        {/* Estado del dataset */}
        {dataset ? (
          <div className="flex items-start gap-3 rounded-xl border border-green-400/40 bg-green-500/10 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-sm font-medium text-green-700 dark:text-green-300">Datos disponibles en el servidor</p>
              <p className="text-xs text-green-600 dark:text-green-400">
                {Number(dataset.total_envios).toLocaleString()} envíos · Rango: {dataset.fecha_min} → {dataset.fecha_max}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-yellow-400/40 bg-yellow-500/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <p className="text-sm text-yellow-700 dark:text-yellow-300">
              No hay datos cargados o el backend no está disponible.
            </p>
          </div>
        )}

        {/* Opción forzar sobreescritura */}
        <label className="flex items-center gap-2 text-xs text-panel-text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={forzar}
            onChange={(e) => setForzar(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-panel-border"
          />
          Sobreescribir datos existentes (forzar)
        </label>

        {/* Tarjetas de carga */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => {
            const st = estado[c.kind];
            const hasSelection = c.multiple ? c.files.length > 0 : !!c.file;
            const inputId = `upload-${c.kind}`;
            return (
              <div key={c.kind} className="flex flex-col rounded-xl border border-panel-border bg-panel-section-bg p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-panel-text-muted">{c.icon}</span>
                  <Label className="text-sm font-semibold">{c.label}</Label>
                </div>

                <input
                  id={inputId}
                  type="file"
                  accept={c.accept}
                  multiple={c.multiple}
                  className="hidden"
                  onChange={(e) => c.onPick(e.target.files)}
                />
                <label htmlFor={inputId}>
                  <div className={`flex h-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                    hasSelection ? 'border-green-400 bg-green-500/10' : 'border-panel-border bg-panel-bg hover:border-primary/40 hover:bg-primary/5'
                  }`}>
                    <FileSpreadsheet className={`h-6 w-6 ${hasSelection ? 'text-green-500' : 'text-panel-text-faint'}`} />
                    <p className="mt-1.5 px-2 text-center text-xs text-panel-text-muted">
                      {c.multiple
                        ? (c.files.length > 0 ? `${c.files.length} archivo(s)` : 'Seleccionar archivos')
                        : (c.file ? c.file.name : 'Seleccionar archivo')}
                    </p>
                    <p className="text-[10px] text-panel-text-faint">{c.hint}</p>
                  </div>
                </label>

                <Button
                  onClick={() => handleSubir(c.kind)}
                  disabled={!hasSelection || st === 'subiendo'}
                  size="sm"
                  className="mt-3 gap-1.5"
                >
                  {st === 'subiendo'
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Subiendo…</>
                    : <><Upload className="h-3.5 w-3.5" />Subir</>}
                </Button>

                <a
                  href={`${BFF}/api/carga/plantillas/${c.kind}`}
                  className="mt-1.5 text-center text-[10px] text-primary hover:underline"
                  download
                >
                  Descargar plantilla
                </a>

                {mensaje[c.kind] && (
                  <p className={`mt-2 flex items-center gap-1 text-[11px] ${
                    st === 'ok' ? 'text-green-600 dark:text-green-400'
                    : st === 'error' ? 'text-red-600 dark:text-red-400'
                    : 'text-panel-text-muted'
                  }`}>
                    {st === 'ok' && <CheckCircle2 className="h-3 w-3" />}
                    {st === 'error' && <X className="h-3 w-3" />}
                    {mensaje[c.kind]}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-panel-text-faint">
          Orden recomendado: primero <strong>aeropuertos</strong>, luego <strong>vuelos</strong> y por último los
          archivos de <strong>envíos</strong>. Tras cargar, el rango de fechas del dataset se actualiza automáticamente.
        </p>
      </div>
    </div>
  );
}

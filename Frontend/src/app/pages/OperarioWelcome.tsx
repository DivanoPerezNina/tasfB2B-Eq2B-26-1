/**
 * OperarioWelcome — pantalla mínima para confirmar que el login por rol
 * funciona. El dashboard real de operario (mapa fijo a su aeropuerto +
 * registro de envíos) se construye en un siguiente paso.
 */
import { Tile, Button, Stack, Tag } from '@carbon/react';
import { UserAvatar, Logout, Location } from '@carbon/icons-react';
import { clearPerfil, Perfil } from '../lib/auth';

export function OperarioWelcome({ perfil, onLogout }: { perfil: Perfil; onLogout: () => void }) {
  const salir = async () => {
    try {
      await fetch(`${import.meta.env.VITE_BFF_URL ?? ''}/api/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${perfil.token}` },
      });
    } catch { /* best-effort */ }
    clearPerfil();
    onLogout();
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem', background: 'var(--cds-background)',
    }}>
      <Tile style={{ maxWidth: '28rem', width: '100%' }}>
        <Stack gap={5}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
            <UserAvatar size={32} />
            <div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
                Bienvenido, {perfil.usuario}
              </h1>
              <p style={{ color: 'var(--cds-text-secondary)', fontSize: '.75rem', margin: 0 }}>
                Sesión de operario iniciada correctamente
              </p>
            </div>
          </div>

          {perfil.aeropuertoIata && (
            <Tag type="blue" renderIcon={Location}>
              Aeropuerto asignado: {perfil.aeropuertoIata}
            </Tag>
          )}

          <p style={{ fontSize: '.875rem', color: 'var(--cds-text-secondary)' }}>
            El registro de envíos para este aeropuerto estará disponible aquí.
          </p>

          <Button kind="danger--tertiary" renderIcon={Logout} onClick={salir}>
            Cerrar sesión
          </Button>
        </Stack>
      </Tile>
    </div>
  );
}

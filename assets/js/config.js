const apiUrl = 'https://100-30-4-62.nip.io';
const vehicleId = 1;

export const CONFIG = Object.freeze({
  apiUrl,
  vehicleId,
  // K-X: ONLY experimental branch / virtual admission; NEVER physical movement.
  // Do not merge into main or deploy while physical legacy control is required.
  guestAdmissionEnabled: true,
  // The app's canControl() hard-locks ALL legacy actuation whenever this is true.
  adminApprovalEnabled: true,
  wsUrl: `wss://${new URL(apiUrl).host}/ws/vehiculos/${vehicleId}`,
  requestTimeoutMs: 12000,
  healthTimeoutMs: 6000,
  databaseHealthTimeoutMs: 9000,
  healthIntervalMs: 45000,
});

// The API exposes these failures as detail strings without a machine-readable error code.
export const BACKEND_DETAILS = Object.freeze({
  databaseUnavailable: 'No fue posible completar la comprobación de lectura de la base de datos.',
  demoConflict: 'Ya existe una DEMO activa o el servicio se está cerrando.',
});

export function isSimulation(search) {
  return new URLSearchParams(search).get('modo') === 'simulacion';
}

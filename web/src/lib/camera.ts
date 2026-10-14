export type CameraPermission = "granted" | "denied" | "prompt" | "unknown";
export type CameraAccess = "granted" | "denied" | "unavailable";

const DISMISSED_KEY = "bites.camera.dismissed";

export function cameraSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** The browser's current camera permission, without prompting. Safari and Chrome both answer; others give "unknown". */
export async function cameraPermission(): Promise<CameraPermission> {
  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    return status.state === "granted" || status.state === "denied" || status.state === "prompt" ? status.state : "unknown";
  } catch {
    return "unknown";
  }
}

/** Asks for the camera once, then lets go of it straight away; the browser remembers the answer. */
export async function requestCameraAccess(): Promise<CameraAccess> {
  if (!cameraSupported()) return "unavailable";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
  }
}

export function cameraDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function dismissCamera(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Not remembering the choice only means the screen shows again next launch.
  }
}

/** Offer the camera step when the browser can capture video and the person has not already said Not now. */
export function shouldOfferCamera(): boolean {
  return cameraSupported() && !cameraDismissed();
}

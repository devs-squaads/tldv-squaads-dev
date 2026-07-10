export const EXTENSION_INSTALL_MODAL_OPEN_EVENT = "squaads:extension-install-modal-open";

export function openExtensionInstallModal(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EXTENSION_INSTALL_MODAL_OPEN_EVENT));
}

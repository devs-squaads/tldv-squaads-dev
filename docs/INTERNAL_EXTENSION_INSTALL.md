# Instalar la extensión interna del navegador

Paquete interno actual:

- `squaads-extension-internal.zip`
- ruta interna prevista: `/downloads/squaads-extension-internal.zip`

## Qué necesitás

- Chrome, Brave u otro navegador basado en Chromium
- acceso al enlace interno de descarga

## Pasos de instalación

1. Descargá `squaads-extension-internal.zip`.
2. Descomprimí el ZIP en una carpeta normal de tu computadora.
3. Abrí `chrome://extensions/` o `brave://extensions/`.
4. Activá `Developer mode`.
5. Tocá `Load unpacked`.
6. Seleccioná la carpeta descomprimida, no el archivo ZIP.
7. Confirmá que la extensión aparece habilitada.
8. Volvé al dashboard de Squaads.
9. Generá tu token de conexión.
10. Abrí el popup de la extensión, pegá el token y usá `Connect to Current Site`.

## Notas importantes

- El ZIP no se puede cargar directo con `Load unpacked`.
- Primero hay que descomprimirlo.
- La carpeta seleccionada debe contener el `manifest.json` de la extensión.
- La ruta de descarga solo funciona cuando el servidor tiene disponible el archivo en `apps/web/private-downloads/squaads-extension-internal.zip`.

## Transición futura

- La distribución interna por ZIP es el camino activo actual.
- Chrome Web Store queda como canal futuro cuando haya presupuesto y el despliegue de producción esté listo.

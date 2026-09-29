# Mantenimiento del fork WebDAV

La extensión vive en esta carpeta. Los archivos originales contienen adaptaciones
pequeñas en los puntos donde Readest resuelve contenido, publica metadatos,
sincroniza o presenta acciones. No hay una copia del lector ni del motor de sync.

## Límites que deben conservarse

- `remoteBook.ts` solo importa tipos. Es la entrada permitida desde cualquier
  consumidor original: identifica libros enlazados, selecciona proveedores y
  combina referencias usando su propio reloj. No añadir stores, HTTP o React.
- `bookSource.ts` es el adaptador de contenido e importación. Fuera de la extensión,
  solo lo usan `services/bookContent.ts` y `services/bookService.ts`.
- `WebDAVLibraryDialog.tsx` recibe la navegación como callback. Solo la página de
  biblioteca lo monta; la extensión no importa las implementaciones de rutas.
- `WebDAVRemoteBookAction.tsx` encapsula la acción del explorador. El explorador
  solo lo monta, sin estados, handlers ni reglas de importación del fork.
- `catalog.ts` recorre el servidor. No trasladar el escaneo a la página original
  ni importar los libros de toda la colección al listar.

Las pruebas `webdav-library-boundaries.test.ts` verifican estos límites. Si aparece
una integración nueva, revisar su necesidad antes de ampliar la lista de entradas.

## Qué conservar al resolver conflictos

| Zona original | Adaptación del fork que hay que conservar |
| --- | --- |
| `types/book.ts` | `remoteSource` opcional y `matchByMetadata` con valor por defecto compatible |
| Menú, cabecera y página de biblioteca | Callback opcional y montaje del diálogo; navegación por la función existente |
| Explorador WebDAV | Importación y montaje de `WebDAVRemoteBookAction` |
| Cliente WebDAV | Opción de rutas decodificadas: escapar `%` literal y conservar espacios de nombres reales |
| Resolución de contenido e importación | Abrir por el adaptador y usar importación sin copia del EPUB ni unión por metadatos |
| Motor de sync y merge | Descubrir referencias sin binario, no subir EPUB enlazados, conservar el reloj de la fuente |
| Entradas de sync manual y automática | Usar `filterBooksForBackend` y `canSyncBookWithBackend` |
| Sync nativo de libros, notas y progreso | Excluir libros identificados por `isWebDAVRemoteBook`, incluidos callbacks en vuelo |
| Disponibilidad, datos y cierre del lector | No descargar desde otros proveedores; invalidar datos antes de cerrar el archivo antiguo |
| Acciones y detalles del libro | Identificar WebDAV y ocultar transferencias de binarios incompatibles |

Durante un rebase, conservar las mejoras de upstream y volver a aplicar estas
adaptaciones sobre sus puntos equivalentes. No sustituir archivos originales
completos con la versión del fork. Si upstream añade un nuevo canal de sync o
cambia la importación/cierre del lector, revisar expresamente los casos anteriores.

## Invariantes funcionales

1. Los EPUB originales permanecen en `Libros/`; `Readest/` contiene referencias y
   sidecars. Nunca subir un EPUB enlazado como parte de Full Sync.
2. Las referencias no contienen URL con credenciales ni datos de autenticación.
3. Solo WebDAV sincroniza estas referencias y sus sidecars, también en sync manual.
4. Una fila antigua sin referencia no borra una referencia existente.
5. El cierre antiguo no puede borrar los datos de una reapertura posterior.
6. Registrar un libro no reemplaza la biblioteca por una instantánea antigua.
7. Listar el catálogo no importa ni descarga el contenido de todos los EPUB.

## Comprobación después de un rebase

Desde `apps/readest-app`:

```text
pnpm lint
pnpm test --run src/__tests__/services/webdav-library src/__tests__/components/webdav src/__tests__/services/sync/file src/__tests__/services/book-content-source.test.ts src/__tests__/services/webdav-list-directory.test.ts src/__tests__/store/reader-store.test.ts src/__tests__/components/settings/fileSyncFormSyncNow.test.tsx src/__tests__/app/library src/__tests__/app/reader/hooks/useFileSync-pullJump.test.ts src/__tests__/hooks/useFileSync.test.ts src/__tests__/hooks/useProgressSync.test.tsx src/__tests__/app/reader/hooks/useNotesSync
pnpm test:browser src/__tests__/components/webdav-library-dialog.browser.test.tsx
pnpm test --run
```

Comparar los fallos generales con la base previa; los fallos existentes del entorno
no sustituyen las pruebas específicas. Comprobar además un servidor real con y sin
HTTP Range, dos dispositivos y apertura/cierre rápido en las plataformas nativas.
No se garantiza un rebase sin conflictos: los cambios de contratos upstream pueden
requerir adaptar estos puntos, pero la lógica de la extensión permanece separada.

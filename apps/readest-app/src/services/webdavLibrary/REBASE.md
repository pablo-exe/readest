# Mantenimiento del fork WebDAV

La lógica del fork vive en esta carpeta. Se reutilizan el importador, la biblioteca,
los grupos, el lector y el motor de sincronización de upstream.

## Adaptaciones que conservar al hacer rebase

| Zona de upstream | Adaptación |
| --- | --- |
| `types/book.ts` | `remoteSource` opcional: proveedor, ruta decodificada, reloj, `libraryId` y `missing`; `matchByMetadata` compatible |
| Página de biblioteca | Una llamada a `useWebDAVLibrary`; sin diálogo de catálogo ni callbacks en cabecera/menú |
| Cabecera y sincronización de biblioteca | `WebDAVSyncProgress` bajo el buscador; `syncProgress` observa el ciclo de WebDAV y el hook solicita un pase al terminar el escaneo |
| Biblioteca/store y Bookshelf | Filtrar `isWebDAVBookMissing` para ocultar fuentes ausentes sin tombstones ni borrar configs |
| Explorador WebDAV | Montar `WebDAVRemoteBookAction` como adaptador de operaciones explícitas |
| Cliente WebDAV | Rutas decodificadas, entidades XML antes de URL, ETag en PROPFIND y rechazo de XML inválido |
| Resolución/importación de contenido | Usar `bookSource.ts`; no copiar el EPUB a Books ni unir versiones por metadatos |
| Sync/merge | Mantener fuentes sin binario y su reloj independiente; solo WebDAV sincroniza sus referencias/sidecars |
| Sync manual/automático y Readest Cloud | Conservar `filterBooksForBackend`, `canSyncBookWithBackend` e `isWebDAVRemoteBook` |
| Cierre del lector | Invalidar datos antes de cerrar el archivo antiguo; `cache.ts` libera y poda después del cierre |
| Acciones/detalles | Excluir transferencias de binarios incompatibles para libros enlazados |

`remoteBook.ts` sigue siendo puro y solo importa tipos. Las entradas con runtime
permitidas desde upstream son `bookSource`, `useWebDAVLibrary` y
`WebDAVRemoteBookAction`, `WebDAVSyncProgress` y `syncProgress`; las pruebas de boundaries comprueban sus consumidores.
La extensión no importa rutas ni las implementaciones de bookService o sync.
Resolver conflictos sobre los puntos equivalentes nuevos de upstream; no sustituir
archivos completos. Si cambian el importador, la identidad por hash, el cierre de
archivos o aparece otro canal de sync, revisar esos contratos expresamente.

## Invariantes

1. La raíz montada, con cualquier nombre, es la fuente de verdad para los EPUB y
   sus grupos. Solo su `Readest/` inmediato se excluye del recorrido.
2. Escanear/leer no mueve, modifica, sube ni borra los EPUB originales.
3. Los datos sincronizados de la app permanecen en `Readest/`; la caché completa
   de cinco EPUB es local, fuera de Books y de los canales de sync.
4. Un escaneo incompleto no declara ausentes los libros que no pudo comprobar.
5. Las fuentes ausentes/reemplazadas conservan configs, progreso y anotaciones,
   sin autorización para borrar archivos del proveedor.
6. El registro combina con el estado vivo y una cancelación no publica el resultado
   de una importación ya obsoleta. Los grupos se estampan con su reloj de upstream.
7. Las referencias no incluyen credenciales. Las claves de índice/caché se separan
   por montaje; referencias antiguas sin `libraryId` se adoptan en el montaje actual.
8. Solo se publica una descarga verificada. La poda nunca borra un archivo abierto.
9. Una fila de un cliente antiguo sin referencia no elimina una referencia nueva.

## Comprobación y recuperación

Ejecutar las pruebas y lint indicados en README. Tras un rebase comprobar también
un montaje de nombre arbitrario con EPUB en la raíz, subcarpetas y caracteres
`&`, `%`, Unicode; un servidor con y sin Range; reapertura sin red tras reiniciar
la app; movimientos, reemplazos, fallo parcial y sincronización entre dispositivos.
Las pruebas simuladas no sustituyen esta comprobación nativa.

Para volver a la implementación anterior, revertir el commit de esta extensión y
reconstruir la app conservando su almacenamiento. Campos nuevos son opcionales y
la lógica anterior ignora `libraryId`/`missing`; por eso las filas conservadas pueden
volver a aparecer y la caché nueva deja de usarse. Reaplicar el commit restaura el
filtrado. No borrar `Books/<hash>/` ni `Readest/` para hacer rollback. El escaneo
nuevo recupera rutas antiguas mal decodificadas cuando encuentra el mismo contenido.

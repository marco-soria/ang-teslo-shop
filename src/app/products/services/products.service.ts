/**
 * Servicio de Productos con Validación de Imágenes y Caché
 *
 * Características de validación de imágenes:
 * - Formatos soportados: JPG, PNG, GIF, WebP, AVIF, BMP, SVG
 * - Tamaño máximo: 5MB por imagen
 * - Conversión automática a JPEG para formatos no soportados por el backend
 * - Validación antes de subida para evitar errores
 *
 * Conversión automática:
 * - WebP, AVIF, BMP, SVG se convierten automáticamente a JPEG
 * - Fallback automático si el backend rechaza un formato
 * - Preserva calidad al 90% en conversiones
 *
 * Características del caché:
 * - Caché de listas de productos por parámetros (limit, offset, gender)
 * - Caché individual de productos por ID/slug
 * - Métodos para invalidar caché específico o general
 *
 * Métodos públicos de validación:
 * - validateImageFile(file): Valida un archivo individual
 * - getAllowedImageFormats(): Obtiene formatos permitidos
 * - getMaxFileSize(): Obtiene tamaño máximo permitido
 *
 * Métodos de gestión de caché:
 * - clearProductsCache(): Limpia todo el caché
 * - invalidateProductsListCache(options?): Invalida caché de listas
 * - invalidateProductCache(idOrSlug): Invalida caché de producto específico
 *
 * Logging:
 * - 🟢 Using cached... (cuando usa caché)
 * - 🔄 Fetching/Updating/Converting... (cuando consulta API o convierte)
 * - ✅ Success operations
 * - 🗑️ Cache operations
 * - 🆕 New product template
 * - 📤 Upload operations
 * - ❌ Error operations
 */

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { User } from '@auth/interfaces/user.interface';
import {
  Gender,
  Product,
  ProductsResponse,
} from '@products/interfaces/product.interface';
import {
  catchError,
  forkJoin,
  map,
  Observable,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';
import { environment } from 'src/environments/environment';

const baseUrl = environment.baseUrl;

interface Options {
  limit?: number;
  offset?: number;
  gender?: string;
}

const emptyProduct: Product = {
  id: 'new',
  title: '',
  price: 0,
  description: '',
  slug: '',
  stock: 0,
  sizes: [],
  gender: Gender.Men,
  tags: [],
  images: [],
  user: {} as User,
};

@Injectable({ providedIn: 'root' })
export class ProductsService {
  private http = inject(HttpClient);

  private productsCache = new Map<string, ProductsResponse>();
  private productCache = new Map<string, Product>();

  // Formatos de imagen permitidos en el frontend
  private readonly ALLOWED_IMAGE_FORMATS = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/avif',
    'image/webp',
    'image/bmp',
    'image/svg+xml',
  ];

  // Formatos que necesitan conversión para el backend
  private readonly FORMATS_NEEDING_CONVERSION = [
    'image/webp',
    'image/avif',
    'image/bmp',
    'image/svg+xml',
  ];

  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB máximo por imagen

  getProducts(options: Options): Observable<ProductsResponse> {
    const { limit = 9, offset = 0, gender = '' } = options;

    const key = `${limit}-${offset}-${gender}`; // 9-0-''
    if (this.productsCache.has(key)) {
      console.log(`🟢 Using cached products list: ${key}`);
      return of(this.productsCache.get(key)!);
    }

    console.log(`🔄 Fetching products from API: ${key}`);
    return this.http
      .get<ProductsResponse>(`${baseUrl}/products`, {
        params: {
          limit,
          offset,
          gender,
        },
      })
      .pipe(
        tap((resp) =>
          console.log(
            `✅ Products fetched successfully: ${resp.products.length} items`
          )
        ),
        tap((resp) => this.productsCache.set(key, resp))
      );
  }

  getProductByIdSlug(idSlug: string): Observable<Product> {
    if (this.productCache.has(idSlug)) {
      console.log(`🟢 Using cached product: ${idSlug}`);
      return of(this.productCache.get(idSlug)!);
    }

    console.log(`🔄 Fetching product from API: ${idSlug}`);
    return this.http.get<Product>(`${baseUrl}/products/${idSlug}`).pipe(
      tap((product) => console.log(`✅ Product fetched: ${product.title}`)),
      tap((product) => this.productCache.set(idSlug, product))
    );
  }

  getProductById(id: string): Observable<Product> {
    if (id === 'new') {
      console.log('🆕 Returning empty product template');
      return of(emptyProduct);
    }

    if (this.productCache.has(id)) {
      console.log(`🟢 Using cached product: ${id}`);
      return of(this.productCache.get(id)!);
    }

    console.log(`🔄 Fetching product from API: ${id}`);
    return this.http.get<Product>(`${baseUrl}/products/${id}`).pipe(
      tap((product) => console.log(`✅ Product fetched: ${product.title}`)),
      tap((product) => this.productCache.set(id, product))
    );
  }

  updateProduct(
    id: string,
    productLike: Partial<Product>,
    imageFileList?: FileList
  ): Observable<Product> {
    const currentImages = productLike.images ?? [];

    return this.validateAndUploadImages(imageFileList).pipe(
      map((imageNames: string[]) => ({
        ...productLike,
        images: [...currentImages, ...imageNames],
      })),
      switchMap((updatedProduct) =>
        this.http.patch<Product>(`${baseUrl}/products/${id}`, updatedProduct)
      ),
      tap((product: Product) => this.updateProductCache(product))
    );
  }

  createProduct(
    productLike: Partial<Product>,
    imageFileList?: FileList
  ): Observable<Product> {
    // Validar y subir imágenes primero, luego crear el producto
    return this.validateAndUploadImages(imageFileList).pipe(
      map((imageNames: string[]) => ({
        ...productLike,
        images: imageNames, // Asignar las imágenes subidas al producto
      })),
      switchMap((productWithImages) =>
        this.http.post<Product>(`${baseUrl}/products`, productWithImages)
      ),
      tap((product: Product) => this.updateProductCache(product))
    );
  }

  updateProductCache(product: Product) {
    const productId = product.id;

    this.productCache.set(productId, product);

    this.productsCache.forEach((productResponse) => {
      productResponse.products = productResponse.products.map(
        (currentProduct) =>
          currentProduct.id === productId ? product : currentProduct
      );
    });

    console.log(
      `🔄 Product cache updated for: ${productId} (${product.title})`
    );
  }

  /**
   * Valida formatos y tamaños de imagen antes de subirlas
   */
  private validateAndUploadImages(images?: FileList): Observable<string[]> {
    if (!images || images.length === 0) {
      return of([]);
    }

    // Validar cada archivo antes de subirlo
    const validFiles: File[] = [];
    const errors: string[] = [];

    Array.from(images).forEach((file, index) => {
      // Validar tipo de archivo
      if (!this.ALLOWED_IMAGE_FORMATS.includes(file.type)) {
        errors.push(
          `File ${index + 1} (${
            file.name
          }): Unsupported format. Allowed: JPG, PNG, GIF, WebP, BMP, SVG`
        );
        return;
      }

      // Validar tamaño del archivo
      if (file.size > this.MAX_FILE_SIZE) {
        errors.push(
          `File ${index + 1} (${file.name}): File too large. Maximum size: 5MB`
        );
        return;
      }

      // Si validación pasa, agregar a archivos válidos
      validFiles.push(file);
    });

    // Si hay errores, mostrarlos en consola y retornar error observable
    if (errors.length > 0) {
      console.error('Image validation errors:', errors);
      return throwError(
        () => new Error(`Image validation failed:\n${errors.join('\n')}`)
      );
    }

    // Si no hay archivos válidos después de las validaciones
    if (validFiles.length === 0) {
      console.warn('No valid images to upload');
      return of([]);
    }

    console.log(`Uploading ${validFiles.length} valid images...`);

    // Proceder con la subida de archivos válidos
    return this.uploadValidatedImages(validFiles);
  }

  /**
   * Sube archivos ya validados
   */
  private uploadValidatedImages(validFiles: File[]): Observable<string[]> {
    const uploadObservables = validFiles.map((imageFile) =>
      this.processAndUploadImage(imageFile)
    );

    return forkJoin(uploadObservables).pipe(
      tap((imageNames) =>
        console.log('Successfully uploaded images:', imageNames)
      )
    );
  }

  /**
   * Procesa una imagen (convierte si es necesario) y la sube
   */
  private processAndUploadImage(imageFile: File): Observable<string> {
    // Si el formato necesita conversión, convertir a JPEG
    if (this.FORMATS_NEEDING_CONVERSION.includes(imageFile.type)) {
      console.log(
        `🔄 Converting ${imageFile.type} to JPEG for backend compatibility...`
      );
      return this.convertToJpeg(imageFile).pipe(
        switchMap((convertedFile) => this.uploadImage(convertedFile))
      );
    }

    // Si es un formato compatible, subir directamente
    return this.uploadImage(imageFile);
  }

  /**
   * Convierte una imagen a formato JPEG usando Canvas
   */
  private convertToJpeg(file: File): Observable<File> {
    return new Observable((observer) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        // Configurar el canvas con las dimensiones de la imagen
        canvas.width = img.width;
        canvas.height = img.height;

        // Dibujar la imagen en el canvas
        ctx!.drawImage(img, 0, 0);

        // Convertir a blob JPEG con calidad del 90%
        canvas.toBlob(
          (blob) => {
            if (blob) {
              // Crear nuevo archivo con el blob convertido
              const convertedFile = new File(
                [blob],
                file.name.replace(/\.[^/.]+$/, '.jpg'), // Cambiar extensión a .jpg
                { type: 'image/jpeg' }
              );
              console.log(
                `✅ Image converted: ${file.name} -> ${convertedFile.name}`
              );
              observer.next(convertedFile);
              observer.complete();
            } else {
              observer.error(new Error('Failed to convert image to JPEG'));
            }
          },
          'image/jpeg',
          0.9
        );
      };

      img.onerror = () => {
        observer.error(new Error(`Failed to load image: ${file.name}`));
      };

      // Cargar la imagen
      img.src = URL.createObjectURL(file);
    });
  }

  /**
   * Método público para validar un archivo individual (útil para UI)
   */
  validateImageFile(file: File): {
    isValid: boolean;
    error?: string;
    willBeConverted?: boolean;
    convertedFormat?: string;
  } {
    if (!this.ALLOWED_IMAGE_FORMATS.includes(file.type)) {
      return {
        isValid: false,
        error: `Unsupported format "${file.type}". Allowed formats: JPG, PNG, GIF, WebP, AVIF, BMP, SVG`,
      };
    }

    if (file.size > this.MAX_FILE_SIZE) {
      return {
        isValid: false,
        error: `File too large (${(file.size / 1024 / 1024).toFixed(
          2
        )}MB). Maximum size: 5MB`,
      };
    }

    // Verificar si necesitará conversión
    const needsConversion = this.FORMATS_NEEDING_CONVERSION.includes(file.type);

    return {
      isValid: true,
      willBeConverted: needsConversion,
      convertedFormat: needsConversion ? 'JPEG' : undefined,
    };
  }

  /**
   * Método público para obtener formatos de imagen permitidos
   */
  getAllowedImageFormats(): string[] {
    return [...this.ALLOWED_IMAGE_FORMATS];
  }

  /**
   * Método público para obtener el tamaño máximo de archivo
   */
  getMaxFileSize(): number {
    return this.MAX_FILE_SIZE;
  }

  /**
   * Limpiar el caché de productos (útil cuando hay actualizaciones masivas)
   */
  clearProductsCache(): void {
    this.productsCache.clear();
    this.productCache.clear();
    console.log('🗑️ Products cache cleared');
  }

  /**
   * Invalidar caché específico de lista de productos
   */
  invalidateProductsListCache(options?: Options): void {
    if (options) {
      const { limit = 9, offset = 0, gender = '' } = options;
      const key = `${limit}-${offset}-${gender}`;
      this.productsCache.delete(key);
      console.log(`🗑️ Products list cache invalidated for: ${key}`);
    } else {
      this.productsCache.clear();
      console.log('🗑️ All products list cache cleared');
    }
  }

  /**
   * Invalidar caché específico de un producto
   */
  invalidateProductCache(idOrSlug: string): void {
    this.productCache.delete(idOrSlug);
    console.log(`🗑️ Product cache invalidated for: ${idOrSlug}`);
  }

  // Tome un FileList y lo suba (método legacy, mantener para compatibilidad)
  uploadImages(images?: FileList): Observable<string[]> {
    if (!images) return of([]);

    const uploadObservables = Array.from(images).map((imageFile) =>
      this.uploadImage(imageFile)
    );

    return forkJoin(uploadObservables).pipe(
      tap((imageNames) => console.log({ imageNames }))
    );
  }

  uploadImage(imageFile: File): Observable<string> {
    const formData = new FormData();
    formData.append('file', imageFile);

    console.log(`📤 Uploading image: ${imageFile.name} (${imageFile.type})`);

    return this.http
      .post<{ fileName: string }>(`${baseUrl}/files/product`, formData)
      .pipe(
        map((resp) => {
          console.log(`✅ Image uploaded successfully: ${resp.fileName}`);
          return resp.fileName;
        }),
        catchError((error: any) => {
          console.error(`❌ Failed to upload image: ${imageFile.name}`, error);

          // Si el error es por formato no soportado y no intentamos conversión aún
          if (
            error.status === 400 &&
            error.error?.message?.includes(
              'Make sure that the file is an image'
            ) &&
            !this.FORMATS_NEEDING_CONVERSION.includes(imageFile.type)
          ) {
            console.log(
              `🔄 Retrying upload with JPEG conversion for: ${imageFile.name}`
            );

            // Intentar conversión a JPEG como fallback
            return this.convertToJpeg(imageFile).pipe(
              switchMap((convertedFile) => {
                const retryFormData = new FormData();
                retryFormData.append('file', convertedFile);

                return this.http
                  .post<{ fileName: string }>(
                    `${baseUrl}/files/product`,
                    retryFormData
                  )
                  .pipe(
                    map((resp) => {
                      console.log(
                        `✅ Image uploaded after conversion: ${resp.fileName}`
                      );
                      return resp.fileName;
                    })
                  );
              })
            );
          }

          // Re-lanzar el error si no se puede manejar
          return throwError(
            () =>
              new Error(
                `Failed to upload image "${imageFile.name}": ${
                  error.error?.message || error.message
                }`
              )
          );
        })
      );
  }
}

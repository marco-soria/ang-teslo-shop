import { Component, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ProductCarouselComponent } from '@products/components/product-carousel/product-carousel.component';
import { ProductsService } from '@products/services/products.service';

@Component({
  selector: 'app-product-page',
  imports: [ProductCarouselComponent],
  templateUrl: './product-page.component.html',
})
export class ProductPageComponent {
  activatedRoute = inject(ActivatedRoute);
  productService = inject(ProductsService);

  productIdSlug = this.activatedRoute.snapshot.params['idSlug'];

  productResource = rxResource({
    params: () => ({ idSlug: this.productIdSlug }),
    stream: ({ params }) =>
      this.productService.getProductByIdSlug(params.idSlug),
  });
}

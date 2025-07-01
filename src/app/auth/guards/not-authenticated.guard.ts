import { CanMatchFn } from '@angular/router';

export const notAuthenticatedGuard: CanMatchFn = (route, segments) => {
  return true;
};

import { withMiddlewareAuthRequired } from '@auth0/nextjs-auth0/edge';

export default withMiddlewareAuthRequired();
export const config = {
    matcher: [
      /*
       * Match all request paths except for the ones starting with:
       * - .swa (Azure static web apps)
       */
      '/((?!.swa).*)',
    ],
  }
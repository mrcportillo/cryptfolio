This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

## Database
This project use vercel postgres database with prisma ORM. Model is defined in `prisma/schema.prisma`. To sync changes in the model run: `npx prisma db push`

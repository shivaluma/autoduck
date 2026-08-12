This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## ĐUA DZỊT — Season 3

Season 3 is isolated from the v2 chest/boss/dragon modifiers. The Duck Duck Race ranking is entered as the vanilla result; the Season 3 rules engine resolves one Chaos card, Bottom penalties, Shields, King status, secret predictions, Duck News, and prediction-point rewards afterward.

Chaos cards: Normal, Reverse, Duo, Triple Elimination, Cut Line, Constructors, and Bounty Hunt. Duo pairs and Constructors teams are randomized once before the race and persisted for the resolve.

- Player view: `/season-3?token=<personal-token>`
- Host control: `/admin/season-3` with `RACE_SECRET_KEY`
- Season 3 API: `/api/season3`, `/api/admin/season3`, `/api/season3/redeem`
- Apply the database migration with `pnpm db:migrate:app` after generating the Prisma client.

The Season 3 champion is calculated from `championshipPoints` and race wins only; prediction points never affect championship ranking.

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

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Setup

On a fresh machine — nothing pre-installed, any distro with apt, dnf, zypper or
pacman — this one line installs Node 22, git, the GitHub CLI, clones the repo to
`~/dev/booking` and scaffolds `.env.local`:

```bash
curl -fsSL https://raw.githubusercontent.com/orapagier/ilovepickleball/main/setup-booking.sh | bash
```

Optional extras go through `bash -s --`:

```bash
curl -fsSL https://raw.githubusercontent.com/orapagier/ilovepickleball/main/setup-booking.sh | bash -s -- --with-vercel --with-pgclient
```

It is safe to re-run: every step skips what is already in place. See
`setup-booking.sh --help` for the full flag list.

## Getting Started

Once setup has run, start the development server:

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

# web

Next.js 15 dashboard. Ozan scaffolds this with:

```bash
pnpm create next-app@latest . --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --use-pnpm
```

Then set `"name": "@payrail/web"` in package.json.

Routes:
- `/buyer` AP queue and approvals (Privy React auth)
- `/supplier` receivables, sell early, World IDKit onboarding
- `/pool` deposit, withdraw, stats

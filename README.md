# ProtoDesign

3D-printing e-commerce storefront: custom quote requests, a product catalog, and
checkout via PhonePe.

- `src/` — React + Vite frontend
- `backend/` — Express API, deployed to AWS Lambda
- `infra/` — SAM template and deploy instructions for the backend
- `docs/lambda-migration-plan.md` — the App Runner → Lambda migration, phase by phase

The App Runner and Amplify URLs previously linked here are being retired — see
the migration plan for the replacement architecture and current status.

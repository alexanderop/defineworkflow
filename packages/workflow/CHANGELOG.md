# Changelog

## [0.5.1](https://github.com/alexanderop/defineworkflow/compare/v0.5.0...v0.5.1) (2026-05-31)


### Bug Fixes

* **release:** make release workflow trusted publisher entrypoint ([e3c87cd](https://github.com/alexanderop/defineworkflow/commit/e3c87cd45364c29ec717108396f43f2e51cecc40))
* **release:** make release workflow trusted publisher entrypoint ([c6810dc](https://github.com/alexanderop/defineworkflow/commit/c6810dc7505e8a6dd349327ce61741fb3dba383d))

## [0.5.0](https://github.com/alexanderop/defineworkflow/compare/v0.4.1...v0.5.0) (2026-05-31)


### Features

* **cli:** bundle local workflow imports with esbuild ([ff088ed](https://github.com/alexanderop/defineworkflow/commit/ff088eda539a5cfe92e9425465c85371e1d11918))
* **cli:** bundle multi-file workflows in the run command ([bb5bff5](https://github.com/alexanderop/defineworkflow/commit/bb5bff589bc42b1664bda213cd19d82dcdab1cc6))
* **cli:** bundleWorkflow passthrough for single-file workflows ([1b5565c](https://github.com/alexanderop/defineworkflow/commit/1b5565c2b478d713c837353569c176aa8e937928))
* **core:** extractMeta reads meta from bundled defineWorkflow output ([2d937a7](https://github.com/alexanderop/defineworkflow/commit/2d937a7f2ea4805516e1df88c205f731128cd8b5))
* **core:** transformScript handles esbuild bundled default export ([cbcbf9a](https://github.com/alexanderop/defineworkflow/commit/cbcbf9ad6986712fe29cb7c21eb1428d1b136b9d))
* multi-file workflows + UI agent navigation ([0da4bf4](https://github.com/alexanderop/defineworkflow/commit/0da4bf45d85669788c20d11682fb0f0c82effaf6))
* **ui:** up/down move agent selection in detail pane, j/k scroll ([531ceb5](https://github.com/alexanderop/defineworkflow/commit/531ceb5e156da915bab6b42a88639a90c6e54967))


### Bug Fixes

* **core:** match esbuild default export alongside sibling named exports ([c4eae14](https://github.com/alexanderop/defineworkflow/commit/c4eae14422759dd74df489bbb1c0b6b37c365f0a))
* **release:** root release-please at repo root so all package commits trigger releases ([2320b75](https://github.com/alexanderop/defineworkflow/commit/2320b7544da480a7bf68b0424dc7d7506746f9fe))
* **release:** root release-please at repo root so all package commits trigger releases ([3f20611](https://github.com/alexanderop/defineworkflow/commit/3f206112510846a77bded3883bc68b335906a6da))

## [0.4.1](https://github.com/alexanderop/defineworkflow/compare/v0.4.0...v0.4.1) (2026-05-31)


### Bug Fixes

* **release:** drop setup-node registry-url so OIDC publish works ([e1e6e8e](https://github.com/alexanderop/defineworkflow/commit/e1e6e8e756efbc18df6eba93dc646f8f9598c0df))
* **release:** drop setup-node registry-url so OIDC publish works ([fc5c045](https://github.com/alexanderop/defineworkflow/commit/fc5c0455fe65d7eb052182fba030bcceccfe49fe))

## [0.4.0](https://github.com/alexanderop/defineworkflow/compare/v0.3.0...v0.4.0) (2026-05-31)


### Features

* **core:** typed pipeline() via fixed-arity overloads ([be9acac](https://github.com/alexanderop/defineworkflow/commit/be9acac55de181bac8fe6d5a6cc7f8b019860a1a))
* **core:** zod-only agent({ schema }) authoring ([1653b15](https://github.com/alexanderop/defineworkflow/commit/1653b159fa86f309068051973d51e2df9a8f1847))
* typed pipeline(), zod-only schemas, and URL in sandbox ([f606990](https://github.com/alexanderop/defineworkflow/commit/f606990b2cc4c7d3a042b00600aaf7c4b18b3f39))

## [0.3.0](https://github.com/alexanderop/defineworkflow/compare/v0.2.0...v0.3.0) (2026-05-31)


### Features

* **core:** adopt type-fest for structural immutability & branded types ([db7c93d](https://github.com/alexanderop/defineworkflow/commit/db7c93d97303f437bcca6578aa1268f4b2ed5390))


### Bug Fixes

* **review:** type WorkflowContext.args via Runtime["args"] for surface consistency ([20300ca](https://github.com/alexanderop/defineworkflow/commit/20300ca402a2f728a23bbacdc06e6ae7a20da634))

## [0.2.0](https://github.com/alexanderop/defineworkflow/compare/v0.1.0...v0.2.0) (2026-05-31)


### Features

* add end-of-run report with per-agent token accounting ([ccf462e](https://github.com/alexanderop/defineworkflow/commit/ccf462e843f35e25abfcb9e85982c9077dce6f9c))
* add reusable agent profiles ([42e6d25](https://github.com/alexanderop/defineworkflow/commit/42e6d252da905d18613a66da87949f68376c0c25))
* **core:** askUserQuestion human-in-the-loop primitive ([26fe51e](https://github.com/alexanderop/defineworkflow/commit/26fe51e6d4ace3e0e7ebbced5202e78cd1956d9c))
* end-of-run report, agent profiles, defineworkflow rebrand, copilot stream fix ([4cd4f34](https://github.com/alexanderop/defineworkflow/commit/4cd4f34dc2e0f7eba4031ccb3cd8e7bbccab546c))


### Bug Fixes

* **workflow:** restore @workflow/* workspace devDeps for build ordering ([947a897](https://github.com/alexanderop/defineworkflow/commit/947a897c0c40ba175bc6727e4081ba18bc8aa182))

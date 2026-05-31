# Changelog

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

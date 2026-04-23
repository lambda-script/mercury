# Changelog

## [2.0.1](https://github.com/lambda-script/mercury/compare/mercury-v2.0.0...mercury-v2.0.1) (2026-04-23)


### Bug Fixes

* **config:** validate MERCURY_MIN_DETECT_LENGTH is a positive integer ([#49](https://github.com/lambda-script/mercury/issues/49)) ([11ce728](https://github.com/lambda-script/mercury/commit/11ce728cb559254ac584284a7b40b6e7c399aac2))
* **deps:** regenerate package-lock.json to fix CI ([#63](https://github.com/lambda-script/mercury/issues/63)) ([5e001d6](https://github.com/lambda-script/mercury/commit/5e001d65acb3bf6c4553c5c2b6ab7118752ec6c6))
* **proxy:** forward non-JSON lines and fix drain race on child exit ([#113](https://github.com/lambda-script/mercury/issues/113)) ([53300cb](https://github.com/lambda-script/mercury/commit/53300cb39fc3369cd88b2021976ce75cc7ad294a))
* **proxy:** handle EPIPE and stream errors without crashing ([#42](https://github.com/lambda-script/mercury/issues/42)) ([3d1799a](https://github.com/lambda-script/mercury/commit/3d1799a7e322491cb6b7e8bbacf1154830af897e))
* **proxy:** harden shutdown and error handling for edge cases ([#98](https://github.com/lambda-script/mercury/issues/98)) ([1466fb5](https://github.com/lambda-script/mercury/commit/1466fb566c4e0e9bbdd4ab64a41ebacee68bb8b2))
* **translator:** add per-attempt timeout to prevent indefinite hangs ([#59](https://github.com/lambda-script/mercury/issues/59)) ([ea17642](https://github.com/lambda-script/mercury/commit/ea17642ce8cf4f543e38b2b5a4afad283b7a015b))
* **translator:** preserve boundary chars when chunking large text ([#60](https://github.com/lambda-script/mercury/issues/60)) ([a31125c](https://github.com/lambda-script/mercury/commit/a31125c71e9f8b3c081259e9459e15afb83d951a))
* **translator:** preserve surrogate pairs when hard-splitting chunks ([#51](https://github.com/lambda-script/mercury/issues/51)) ([de55a3e](https://github.com/lambda-script/mercury/commit/de55a3e3f661c91e89f2fd7f8bdeb3f4308b898b))


### Performance Improvements

* reduce allocations in hot paths ([#107](https://github.com/lambda-script/mercury/issues/107)) ([12bdb6b](https://github.com/lambda-script/mercury/commit/12bdb6ba37c805e3cbfd87a50a68deecfeb3b3d4))
* reduce allocations in stdio proxy, JSON walker, and detector ([#92](https://github.com/lambda-script/mercury/issues/92)) ([7ac460f](https://github.com/lambda-script/mercury/commit/7ac460f1fc87db6eb097429ee537649f543607f1))
* **transform:** skip JSON re-stringify when no strings were translated ([#61](https://github.com/lambda-script/mercury/issues/61)) ([6f838fb](https://github.com/lambda-script/mercury/commit/6f838fb305a6b070a8d34a59fc5aaacc3370c9ee))


### Code Refactoring

* extract shared helpers and parallelize text block translation ([#95](https://github.com/lambda-script/mercury/issues/95)) ([d10f28e](https://github.com/lambda-script/mercury/commit/d10f28e373a220da1701def5d93a2247b0490c23))
* **proxy:** deduplicate error handling and centralize response guard ([#111](https://github.com/lambda-script/mercury/issues/111)) ([500d8b4](https://github.com/lambda-script/mercury/commit/500d8b4f4579bf8acfc732f7a6a2254e2369e800))
* **transform:** parallelize JSON object walker and tighten types ([#58](https://github.com/lambda-script/mercury/issues/58)) ([24a2327](https://github.com/lambda-script/mercury/commit/24a23277841c03475417252bcb017c08583b3116))


### Documentation

* add missing JSDoc and MERCURY_HAIKU_MODEL to --help ([#97](https://github.com/lambda-script/mercury/issues/97)) ([66c42c7](https://github.com/lambda-script/mercury/commit/66c42c7ebf659ca9da7fe65cebd5666a89045e11))
* add missing strings.ts to README architecture tree ([#112](https://github.com/lambda-script/mercury/issues/112)) ([cebdf25](https://github.com/lambda-script/mercury/commit/cebdf25bc4746143418548952d6495d3d1d3e063))
* clarify docs and error messages for new contributors ([#57](https://github.com/lambda-script/mercury/issues/57)) ([d31a9cb](https://github.com/lambda-script/mercury/commit/d31a9cba05e1d682e63e63e4af9f31eb71c615d6))


### Tests

* add edge-case tests and boost coverage from 92% to 97% ([#96](https://github.com/lambda-script/mercury/issues/96)) ([29381ab](https://github.com/lambda-script/mercury/commit/29381ab6abfdc482f3f3241184ec2e0497dd21f7))
* add edge-case tests and boost coverage from 97% to 98% ([#108](https://github.com/lambda-script/mercury/issues/108)) ([df15a27](https://github.com/lambda-script/mercury/commit/df15a27f11be047368ac7cc114cb4c1452a693da))
* expand edge-case coverage for proxy, transform, and translators ([#55](https://github.com/lambda-script/mercury/issues/55)) ([2364bc9](https://github.com/lambda-script/mercury/commit/2364bc94a9ab0cb3da5ab46329d58383db59d05e))


### CI/CD

* remove daily schedule from claude-maintenance ([#114](https://github.com/lambda-script/mercury/issues/114)) ([d4ae443](https://github.com/lambda-script/mercury/commit/d4ae443f31f7ea6be106f7e010bba6d3109ca781))

## [2.0.0](https://github.com/lambda-script/mercury/compare/mercury-v1.0.1...mercury-v2.0.0) (2026-04-06)


### ⚠ BREAKING CHANGES

* mercury now operates as a stdio proxy instead of an HTTP proxy. Configuration via .mcp.json args instead of URL.

### Features

* add google-free translator, oauth support, and config enhancements ([c765a29](https://github.com/lambda-script/mercury/commit/c765a297231d887bcb5824deb2ba2a2123f7b600))
* inject response language instruction into system prompt ([f774de6](https://github.com/lambda-script/mercury/commit/f774de6c11003a5371c9f9c217e1ed74629cec4e))
* inject response language instruction into system prompt ([e857ba9](https://github.com/lambda-script/mercury/commit/e857ba9f09a7da512a6624d1eb28978dc4e29f67))
* rename to @lambda-script/mercury with npx support ([01a2e04](https://github.com/lambda-script/mercury/commit/01a2e040a41436debe4e225e37b9bf0362b63e19))


### Bug Fixes

* **ci:** downgrade @eslint/js to v9 to resolve peer dependency conflict ([2d5f111](https://github.com/lambda-script/mercury/commit/2d5f1119bd2632711d3b4369fa419c2121e57e59))
* **ci:** downgrade @eslint/js to v9 to resolve peer dependency conflict ([3a591fc](https://github.com/lambda-script/mercury/commit/3a591fcd484041e1ae973bf5b1222aab36ac177e))
* **ci:** improve release-please config and npm publish reliability ([#34](https://github.com/lambda-script/mercury/issues/34)) ([56cdfc9](https://github.com/lambda-script/mercury/commit/56cdfc92d3408e3848a9622bab82c71b5be7e57c))
* **proxy:** correct tracker eviction to remove oldest entry by timestamp ([#15](https://github.com/lambda-script/mercury/issues/15)) ([de58e52](https://github.com/lambda-script/mercury/commit/de58e528f9320aacc8a6fa8432c8a80a13253fd3))
* **proxy:** forward signals to child process and drain queue before exit ([#23](https://github.com/lambda-script/mercury/issues/23)) ([27cf85d](https://github.com/lambda-script/mercury/commit/27cf85d3cc398ae28f7ff0fe97dea4dd0425dd46))
* **proxy:** improve signal handling and graceful shutdown ([#31](https://github.com/lambda-script/mercury/issues/31)) ([500b8b8](https://github.com/lambda-script/mercury/commit/500b8b8e64424c606b1c8c93542aa08a49ba91d9))


### Performance Improvements

* **detector:** cache last detection result to avoid redundant franc calls ([#25](https://github.com/lambda-script/mercury/issues/25)) ([ac0dec0](https://github.com/lambda-script/mercury/commit/ac0dec03848c4aea3a17c1b2e85fe6c2f8622888))
* **tokens:** replace regex matches with single-pass character loop ([#24](https://github.com/lambda-script/mercury/issues/24)) ([7f982c5](https://github.com/lambda-script/mercury/commit/7f982c5561f466264220162eda6651e5b7cc78c7))
* **transform:** hoist regexes and avoid string copies in hot paths ([#32](https://github.com/lambda-script/mercury/issues/32)) ([d27b121](https://github.com/lambda-script/mercury/commit/d27b121ca8257ae55918586de749ad238f14f321))


### Code Refactoring

* improve error messages to be more actionable ([#17](https://github.com/lambda-script/mercury/issues/17)) ([cdc85d7](https://github.com/lambda-script/mercury/commit/cdc85d785df2e76c703903cba50d4402b0cad185))
* migrate from HTTP proxy to stdio proxy architecture ([696296e](https://github.com/lambda-script/mercury/commit/696296e455a2e31c0e3cc32a2513c55e21e36a34))
* **proxy:** export stripOutputSchemas and harden promise queue ([#28](https://github.com/lambda-script/mercury/issues/28)) ([2a578bf](https://github.com/lambda-script/mercury/commit/2a578bfcbdf9ff01a66065b72bafee458d8ba266))
* **proxy:** improve stdio.ts readability and shutdown handling ([#13](https://github.com/lambda-script/mercury/issues/13)) ([1d91d46](https://github.com/lambda-script/mercury/commit/1d91d46bb0918caa16f021a1b77b1f95ebb70026))
* **transform:** add safety and performance improvements to JSON walker ([#14](https://github.com/lambda-script/mercury/issues/14)) ([c189fb2](https://github.com/lambda-script/mercury/commit/c189fb23e5a5a5909686ac42eadc240d00282bd3))
* **transform:** extract shared translateAndTrack helper ([#27](https://github.com/lambda-script/mercury/issues/27)) ([54e4517](https://github.com/lambda-script/mercury/commit/54e4517be726e79199fb861ae7c57747cc1b62e5))


### Documentation

* add governance documents for OSS publication ([#7](https://github.com/lambda-script/mercury/issues/7)) ([07fea11](https://github.com/lambda-script/mercury/commit/07fea11a169dc191032674bef93946f7710e8d6d))
* add JSDoc to exported interfaces, improve error messages and README accuracy ([#30](https://github.com/lambda-script/mercury/issues/30)) ([f7aafcf](https://github.com/lambda-script/mercury/commit/f7aafcf736c0fdf4c10d72052890312a0c4d0c7a))
* document response language injection feature ([05c13a8](https://github.com/lambda-script/mercury/commit/05c13a8b565b41a19b5b963d0d0e0fc61e6c6223))
* document response language injection feature ([7e4b34b](https://github.com/lambda-script/mercury/commit/7e4b34bebab449660b4a1be7d9d3d2bd695a9a69))
* simplify SECURITY.md to use GitHub Issues ([#8](https://github.com/lambda-script/mercury/issues/8)) ([6c02155](https://github.com/lambda-script/mercury/commit/6c02155a89c14b06ea651aa564d5565ec40fb98b))
* update documentation for OSS release ([1e4216a](https://github.com/lambda-script/mercury/commit/1e4216ae0b6e6ec331b8643f0951ab79eb3400bb))
* update README with multilingual benchmark results ([fca7c68](https://github.com/lambda-script/mercury/commit/fca7c6872437e2064e6bae9d42ab2823b2679e63))


### Tests

* **logger:** improve test coverage to 100% ([#11](https://github.com/lambda-script/mercury/issues/11)) ([783d7a4](https://github.com/lambda-script/mercury/commit/783d7a4218e1cc856cd6ad061e974ce07c8e67a8))


### CI/CD

* add Claude Code Actions with matrix-based maintenance ([#12](https://github.com/lambda-script/mercury/issues/12)) ([b3f3427](https://github.com/lambda-script/mercury/commit/b3f34273c498ff9768a9157f2f9496d349679e2f))
* add Claude Code Actions workflows ([#10](https://github.com/lambda-script/mercury/issues/10)) ([d5b63de](https://github.com/lambda-script/mercury/commit/d5b63deaa88bb8b2c67accddf8325c67514f02dc))
* consolidate release workflow into release-please ([#9](https://github.com/lambda-script/mercury/issues/9)) ([444eb35](https://github.com/lambda-script/mercury/commit/444eb352f0b670719dec5120ad647fa6af3ac1b9))
* **maintenance:** use opus and remove max-turns limit ([#18](https://github.com/lambda-script/mercury/issues/18)) ([616f5dc](https://github.com/lambda-script/mercury/commit/616f5dcee5703e9011257a5827987d10a53fb7a6))
* migrate from version.yml to release-please for automated releases ([59fa52d](https://github.com/lambda-script/mercury/commit/59fa52d73e76febe626c04be3bdfecc335b54aa2))
* migrate to release-please for automated releases ([c282135](https://github.com/lambda-script/mercury/commit/c282135e37e33587816dd3fa08a51b6b6c62b454))

## [1.0.1](https://github.com/lambda-script/mercury/compare/v1.0.0...v1.0.1) (2026-04-05)


### Bug Fixes

* **proxy:** correct tracker eviction to remove oldest entry by timestamp ([#15](https://github.com/lambda-script/mercury/issues/15)) ([de58e52](https://github.com/lambda-script/mercury/commit/de58e528f9320aacc8a6fa8432c8a80a13253fd3))

## 1.0.0 (2026-04-04)


### ⚠ BREAKING CHANGES

* mercury now operates as a stdio proxy instead of an HTTP proxy. Configuration via .mcp.json args instead of URL.

### Features

* add google-free translator, oauth support, and config enhancements ([c765a29](https://github.com/lambda-script/mercury/commit/c765a297231d887bcb5824deb2ba2a2123f7b600))
* inject response language instruction into system prompt ([f774de6](https://github.com/lambda-script/mercury/commit/f774de6c11003a5371c9f9c217e1ed74629cec4e))
* inject response language instruction into system prompt ([e857ba9](https://github.com/lambda-script/mercury/commit/e857ba9f09a7da512a6624d1eb28978dc4e29f67))
* rename to @lambda-script/mercury with npx support ([01a2e04](https://github.com/lambda-script/mercury/commit/01a2e040a41436debe4e225e37b9bf0362b63e19))


### Bug Fixes

* **ci:** downgrade @eslint/js to v9 to resolve peer dependency conflict ([2d5f111](https://github.com/lambda-script/mercury/commit/2d5f1119bd2632711d3b4369fa419c2121e57e59))
* **ci:** downgrade @eslint/js to v9 to resolve peer dependency conflict ([3a591fc](https://github.com/lambda-script/mercury/commit/3a591fcd484041e1ae973bf5b1222aab36ac177e))


### Code Refactoring

* migrate from HTTP proxy to stdio proxy architecture ([696296e](https://github.com/lambda-script/mercury/commit/696296e455a2e31c0e3cc32a2513c55e21e36a34))

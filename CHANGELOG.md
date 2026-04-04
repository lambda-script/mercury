# Changelog

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

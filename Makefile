
node_modules: package.json
	@npm install

test:
	@mocha

.PHONY: test


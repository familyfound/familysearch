
lint:
	@jshint *.json *.js lib

node_modules: package.json
	@npm install

test:
	@./node_modules/.bin/mocha

.PHONY: test


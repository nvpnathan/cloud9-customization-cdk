include .env

.PHONY: clean
clean:
	rm -f $(ZIPFILE)
	find . -name '*.js' ! -name 'jest.config.js' -not -path './node_modules/*' -delete
	find . -name '*.d.ts' -not -path './node_modules/*' -delete
	rm -rf cdk.out/

.PHONY: build
build:
	npm run build

.PHONY: synth
synth: build
	npx cdk synth Cloud9CustomizationCdkStack

.PHONY: deploy
deploy: synth
	npx cdk deploy Cloud9CustomizationCdkStack --require-approval=never \
		--previous-parameters=false \
		--parameters Cloud9CustomizationCdkStack:WorkspaceOwnerRoleArn=$(C9_ROLE_ARN)

.PHONY: destroy
destroy:
	npx cdk destroy Cloud9CustomizationCdkStack --force

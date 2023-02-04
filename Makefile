C9_ROLE_ARN ?= arn:aws:sts::758938277263:assumed-role/Admin/umishaq-Isengard

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
	npx cdk synth EcsWorkshopCloud9Stack --no-path-metadata

.PHONY: deploy
deploy: synth
	npx cdk deploy EcsWorkshopCloud9Stack --require-approval=never \
		--previous-parameters=false \

.PHONY: zeploy
zeploy: synth
	npx cdk deploy EcsWorkshopCloud9Stack --require-approval=never \
		--previous-parameters=false \
		--parameters EcsWorkshopCloud9Stack:EETeamRoleArn=$(C9_ROLE_ARN)

.PHONY: destroy
destroy:
	npx cdk destroy EcsWorkshopCloud9Stack --force

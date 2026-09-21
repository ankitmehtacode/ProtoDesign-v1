# Invoked by `sam build` because template.yaml sets
# ApiFunction.Metadata.BuildMethod: makefile. The target name is fixed by SAM's
# convention: build-<LogicalId of the function resource>.
#
# This reuses backend/build.mjs (esbuild + a require() shim for CJS deps)
# instead of SAM's own esbuild integration, so the artifact deployed here is
# byte-for-byte the same build already exercised by backend/test/ and the
# Phase 1/2 smoke tests, not a second, unverified bundling path.
#
# SAM sets ARTIFACTS_DIR; CodeUri in template.yaml points at ../backend, so
# that is where this target runs from.
build-ApiFunction:
	npm ci --no-audit --no-fund
	npm run build
	cp dist/lambda.mjs "$(ARTIFACTS_DIR)/lambda.mjs"

# Generation and Delivery Traceability

The generator accepts optional `metadata: {schemaVersion: 1, medolVersion,
source: {sha256, workspaceId?, versionId?, versionNo?, modelHash?, release?}}`.
`source.sha256` is SHA-256 of the exact UTF-8 DSL bytes, without newline
normalization. `source.medol` lives beside the exported JSON. Download completes
and the hash is checked before either output is written. Stable metadata requires
both that source file and a strict `release: {channel: "stable", label: "vX.Y.Z"}`.
Other channels and metadata-free inputs retain legacy image/package defaults.
Release notes and arbitrary metadata are not copied into public manifests.

Stable Maven/npm package versions are `X.Y.Z`; image versions are canonical
`vX.Y.Z.N` with no leading zeroes. Stable default image version is `vX.Y.Z.0`.
Explicit tags must match the model baseline. Four-part tags cannot identify drafts.

## Generated Records

Each output gets `.medol/generation/<target>.json`, schema version 1, containing:

- `target`, `scope`, `generatedAt`, allowlisted `selection`.
- `generator: {name, version, sha256}` (generator sources/templates/lockfile).
- `model: {sha256, metadata?}` (exact exported JSON input hash).
- `config: {sha256}` (configuration and selected options, never secret values).
- `inputs: [{path, sha256}]`, relative to the generation output root.

Scope is `application` for an `all` generation, `partial` for other passes,
and `release-support` for the focused sync command. A support refresh does not
claim to have regenerated existing domain code. All present input hashes are
checked at build/export/push, including external workspace inputs. Stable builds
require a recorded and present `source.medol`. Package versions must match the
stable baseline; partial generation does not silently update existing packages.

## Shared Runtime API

Source: `.generator/common/release-runtime.mjs`. Generated copies:
`scripts/release-runtime.mjs` and `operations/<environment>/release-runtime.mjs`.
The helper has only Node standard-library dependencies and can be copied into a
hand-written service's scripts directory.

```js
import {prepareRelease, defaultImageVersion} from './release-runtime.mjs';

const version = defaultImageVersion({root: repoRoot, target: 'operations'});
const release = prepareRelease({
  root: engineRoot,
  generationRoot: repoRoot, // defaults to root; inputs resolve relative to this
  target: 'operations',
  version,
  variant: 'cpu', // optional safe filename component; separates profile claims
  operation: 'build', // export/push reuse the matching recorded build options
  buildOptions: {platform: 'linux/amd64', profile: 'cpu'}, // only its hash persists
  dryRun: false,
});
release.claim(); // before compilation, Docker build or push
release.embed(['public/medol-build.json']); // also claims; paths relative to root
// Docker: append release.dockerArgs. Maven/Jib: append release.jibArgs.
release.writeManifest('.medol/build-manifest.json', [imageName]);
release.verifyImages([imageName]); // all selected images BEFORE export/push
// Push only after successful preflight; then require repository digests:
release.writeManifest('.medol/release-manifest.json', [imageName], {
  requireRepoDigests: true,
});
```

`release.manifest` and `release.labels` are also public. Prepare sessions only for
build/export/push/package, not import/help/list. Offline imports do not need the
source workspace. Draft and legacy images do not require provenance labels;
inspection failures still fail manifest creation. Dry runs make no claims or
files and return null image IDs.

Application archive exports stream a SHA-256 checksum into the sidecar together
with byte size, image IDs and labels. Imports require that sidecar, verify the
bytes before Docker loading, then verify loaded identities without source files.
Old archives without sidecars require an explicit legacy `docker load -i` command.
Batch operations verify every selected application archive before the first load.

Manifest schema version 1 includes `builtAt`, `imageVersion`, `packageVersion?`,
`buildIdentity`, `codeSha256`, `buildOptionsSha256`, optional `variant`,
`git: {revision, dirty}`, `generation`, and
`images: [{name, id, repoDigests}]`. Backend embeds metadata at
`META-INF/medol-build.json`; frontend serves `medol-build.json`. Digests become
available after push; local Docker image IDs are recorded after build.
OCI version/revision and `tech.medol.{build.identity,code.sha256,model.sha256,
source.sha256,generator.sha256,generation.sha256}` labels link an image to inputs.
Jib labels use the supported `jib.container.labels` map property
([Jib configuration](https://github.com/GoogleContainerTools/jib/blob/master/jib-maven-plugin/src/main/java/com/google/cloud/tools/jib/maven/JibPluginConfiguration.java)).

`.medol/baselines/vX.Y.Z.json` pins a baseline's source SHA across all BUILD
numbers. `.medol/releases/<version>[--variant].identity.json` reserves each
version against code, generation and build options before a build. Timestamp,
`.medol`, build output directories and generated metadata/archive files are
excluded from the code fingerprint; actual application `manifest.json` is included.
The initial completion record and individual `--image-<hash>.json` records are
immutable. Individual records accumulate modules built in separate invocations.
Do not delete these ledgers to reuse a published tag; increment BUILD for changed
code/options and create a new baseline label for changed DSL. Persist `.medol`
release/baseline ledgers with the delivery workspace. This is local traceability,
not a signed registry attestation or a distributed locking service.

Operations build/push/export creates an aggregate
`<bundle-output>/release-manifest.json` with component manifest paths, identities,
generation metadata and image IDs/digests. Components must share imageVersion and
model input SHA. Export archive sidecars are `<archive>.manifest.json`; the package
`manifest.json` includes the same aggregate plus deployment/archive information.
Export and push use `operation: 'export'` or `'push'` to reuse the recorded build
options and original Git identity. They still reject changed source, generation
inputs or mismatching images. Build arguments do not need to be supplied again.
Stable backend deliveries require a fresh Maven reactor install; the
`--skip-install` fast path remains available for development builds only.

## Focused Sync

Run these from the code-generator repository. Outputs below are placeholders;
only support scripts, records and stable package versions are refreshed.
Existing application source and deployment configuration are not regenerated.

```bash
node sync-release-support.js --cwd /path/to/workspace --model .medol/codegen-model.json \
  --root /path/to/workspace/backend --target axon5 --modules service-a,service-b
node sync-release-support.js --cwd /path/to/workspace --model .medol/codegen-model.json \
  --root /path/to/workspace/console --target refine --image console
node sync-release-support.js --cwd /path/to/workspace --model .medol/codegen-model.json \
  --root /path/to/workspace --target operations --environment dev
node sync-release-support.js --cwd /path/to/workspace --model .medol/codegen-model.json \
  --root /path/to/workspace/engine --target runtime-engine
```

For an engine using the root operations generation record, copy the common helper
to `engine/scripts/release-runtime.mjs` and use `generationRoot` as above instead
of creating a separate engine record. The API is also exported as CommonJS
`require('./sync-release-support').syncReleaseSupport(options)` for integration.
The Docker image includes `/opt/codegen/sync-release-support.js`.

Full regeneration remains `gen --generator axon5 --generator-type all --all-slices`,
`gen --generator refine --generator-type Skeleton --all-commands --skip-install`
followed by `--generator-type all`, and
`gen --generator operations --generator-type all --environment dev --skip-install`.

## Verification

```bash
node --test .generator/common/test/release-pipeline.test.js
cd .generator && npm test
```

The focused suite includes actual Yeoman backend/frontend/operations generation,
stable package versions, generated list/build dry runs, offline imports, source
download preservation/failure, stale inputs, immutable versions/options/variants,
baseline pinning, publish label/ID checks and required pushed digests.


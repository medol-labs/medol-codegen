# Local Runtime And Delivery Platforms

Runtime architecture and delivery architecture are independent. Without --platform,
image commands use DOCKER_DEFAULT_PLATFORM if set, otherwise the Docker Engine's
architecture (not the CLI machine). For cross-machine packaging always pass the
destination platform explicitly. Dry-run does not contact Docker and assumes the
client architecture unless --platform is provided.

## Dependencies

```bash
node scripts/dependency-images.mjs pull --image postgres:16,umadb/umadb:0.7.8 --platform linux/amd64
node scripts/dependency-images.mjs pull --image postgres:16,umadb/umadb:0.7.8 --platform linux/arm64
node scripts/dependency-images.mjs export --image postgres:16,umadb/umadb:0.7.8 --platform linux/arm64 --output dependencies-arm64.tar
node scripts/dependency-images.mjs select --image postgres:16,umadb/umadb:0.7.8 --platform linux/amd64
```

Pull reuses a matching local image or its platform cache, with no registry request.
Use --refresh to check a mutable upstream tag deliberately. Same-platform refresh
updates the public tag; cross-platform pulls preserve the existing platform tag.
The first pull of a
previously uncached architecture still needs a download. Docker shares matching
layers; amd64 and arm64 binaries are not interchangeable.

## Applications

```bash
node scripts/image-bundle.mjs build --platform linux/amd64
node scripts/image-bundle.mjs build --platform linux/arm64
node scripts/image-bundle.mjs export --platform linux/arm64 --output applications-arm64.tar
node scripts/image-bundle.mjs select --platform linux/amd64
```

Application builds preserve the prior image in a platform-qualified local cache,
then cache the new result. Build still compiles changed source; it does not treat
the existence of a tag as proof that code is current. Jib/BuildKit continue to use
their normal layer caches. select changes public tags to the requested cached
architecture without rebuilding or downloading; it does not recreate containers.
Use the same prefix/version/module selection as the original build.

Cache tags are medol-platform-cache/<hash-of-reference>:<os>-<arch>[-variant].
They are local retention references, not published versions. Pruning these images
removes the guarantee of offline reuse. Legacy overwritten/dangling images are not
guessed by repository or size; only verified references are adopted automatically.
Do not replace stable release provenance: immutable version/build identity rules
still apply and may require a separate delivery version for a different build.
This is not a multi-architecture OCI manifest publishing implementation.

Export/push temporarily select the requested cached architecture and restore the
original source tags even on ordinary failures. Export fails instead of silently
saving the wrong architecture. Do not run simultaneous builds, exports, pulls or
Compose recreation against the same image tags on one Docker daemon. Forced
termination cannot guarantee restoration; select explicitly after interruption.
Archives retain original public tags, so loading on a destination remains compatible
with its Compose configuration. Scripted imports cache old tags before loading and
cache verified incoming images afterward. Direct docker load bypasses that protection.
Loading an archive can replace destination tags;
select the desired architecture before recreating local containers.

Development build records additionally retain platform- and plugin-qualified manifests.
Generation-input hash checks and release identity checks are not bypassed.
Hand-written services must integrate the helper explicitly. The reference runtime
engine uses the same cache and select command; keep its --plugin-profile consistent
between build, export and select.

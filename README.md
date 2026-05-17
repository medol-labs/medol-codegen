# ES Code Generator

Custom Nebulit/Yeoman code generator for generating Axon-based Kotlin/Spring Boot code from `config.json`.

The project wraps `nebulit/codegen` with a custom Docker image. The custom image bakes `.generator` and its `node_modules` into the image, then overrides `gen` so the default command runs the local generator.

## Image Layout

Inside the container:

```text
/opt/codegen/.generator    custom generator bundled in the image
/workspace                 mounted project workspace
```

Running `gen` with no arguments is equivalent to:

```bash
gen /opt/codegen/.generator/app/
```

Running `gen` with arguments delegates to the original `nebulit/codegen` command:

```bash
gen <args>
```

## Build Image

Build the custom image from this repository:

```bash
docker build -f Dockerfile.codegen -t es-codegen .
```

The image build:

- starts from `nebulit/codegen`
- installs `yo@5.1.0`
- sets `HOME=/tmp/yo-home`
- copies `.generator` to `/opt/codegen/.generator`
- runs `npm install` inside `/opt/codegen/.generator`
- wraps the original `gen` command as `gen-original`

## Run Container

From the project directory that contains `config.json`:

```bash
docker run -it \
  -p 3001:3000 \
  -v $PWD:/workspace \
  --name codegen \
  --rm \
  es-codegen
```

The mounted `/workspace` is where generated files are written.

## Generate Code

Inside the container:

```bash
gen
```

Then select:

- `Skeleton` to generate the base Kotlin/Spring Boot project structure
- `slices` to generate slice-level commands, events, read models, REST resources, processors, and specifications
- `aggregates` to generate Axon aggregate code

You can still invoke other generators explicitly:

```bash
gen @dilgerma/nebulit
gen /some/other/generator
```

## Configuration

The generator reads:

```text
/workspace/config.json
```

Expected `codeGen` fields include:

```json
{
  "codeGen": {
    "application": "Quiz",
    "rootPackage": "de.nebulit.quiz"
  }
}
```

If these fields exist, the generator uses them as defaults and only asks what should be generated.

## Updating The Generator

Because `.generator` is copied into the image, changes to generator code require rebuilding the image:

```bash
docker build -f Dockerfile.codegen -t es-codegen .
```

You do not need to run `npm install` manually on the host. Generator dependencies are installed during image build.

## Install Dependencies

```bash
cd .generator
npm install
```

## Build image

```bash
docker build -f Dockerfile.codegen -t es-codegen .
```

## Run

```bash
docker run -it -p 3001:3000 -v $PWD:/workspace --name codegen --rm es-codegen
```

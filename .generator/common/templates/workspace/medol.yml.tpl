name: Medol Generated System

generators:
  axon5:
    output: backend
  refine:
    output: console
  operations:
    output: .

operations:
  # Configure this only when images are pushed to a registry.
  # registry:
  #   host: registry.internal:5000
  #   scheme: http
  #   namespace: team
  #   insecure: true

workspaceFiles:
  overwrite: false


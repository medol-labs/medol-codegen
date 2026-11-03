# Native K3s Installation: v1.33.5+k3s1

This manual installs a new native Linux K3s cluster, not k3d. The example pins
`v1.33.5+k3s1` (the release tag contains `+`, not `-`). It is a reproducible
version example, not a recommendation to use an old patch release indefinitely.
Review security/support status before production use. All nodes must use the
same selected version and architecture-compatible artifacts.

Do not run this procedure over an existing newer cluster. In particular, do
not replace a v1.37 RC binary with v1.33.5 against the same datastore. Back up
existing data and plan a supported migration or a separate clean installation.
Do not uninstall or delete `/var/lib/rancher/k3s` to resolve a startup error.

## 1. Plan the cluster

- One server is enough for a functional cluster and can run workloads too;
  additional agents provide capacity, not control-plane high availability.
- Independent deployment sites may use separate clusters. Follow this manual
  for each cluster; only join workers intended to share its control plane.
- Use unique DNS-compatible node names, stable addresses and synchronized clocks.
- Permit TCP 6443 from agents/admin clients to the server, TCP 10250 between
  appropriate nodes, and UDP 8472 between nodes for the default Flannel VXLAN.
  Do not expose VXLAN to untrusted networks. Permit application NodePorts such
  as TCP 30080 only to intended clients. Review the official requirements for
  additional ports if changing network/datastore modes.
- Keep CoreDNS and local-path-provisioner enabled. This example disables Traefik
  because application delivery supplies APISIX; installing K3s alone does not
  install the application gateway or expose the application UI.

## 2. Check each Linux node

```bash
cat /etc/os-release
uname -m
uname -r
stat -fc %T /sys/fs/cgroup
free -h
df -h /var/lib
swapon --show
timedatectl status
```

`aarch64` uses ARM64 artifacts; `x86_64` uses AMD64 artifacts. Prefer cgroup v2
(`cgroup2fs`). Do not change cgroup mode on a running workload node without a
maintenance window. A v1.33.5 installation and a newer Kubernetes version may
have different cgroup defaults; do not infer compatibility from the version alone.
For this simple setup, disable swap and arrange for it not to return at boot:

```bash
sudo swapoff -a
```

Review `/etc/fstab` and other swap managers before editing; preserve a backup
and do not remove unrelated filesystems. Install required host utilities and
SELinux policy packages from approved repositories/offline media. On enforcing
SELinux hosts, prepare compatible `k3s-selinux` dependencies before offline
installation; do not disable SELinux to bypass missing packages.

### openEuler cgroup v2 preparation when necessary

For the previously used openEuler 24.03 / Linux 6.6 host, check `grubby` and
record the boot entry before editing. Ensure console access before rebooting:

```bash
command -v grubby
cat /proc/cmdline
sudo grubby --info="/boot/vmlinuz-$(uname -r)"
```

If no `grubby` is available, use the OS-specific bootloader procedure instead
of guessing an ARM/UEFI GRUB output path. If a conflicting cgroup boot option
exists, review it before proceeding. To enable the unified hierarchy for the
current kernel, preserving other boot parameters:

```bash
sudo grubby --update-kernel="/boot/vmlinuz-$(uname -r)" \
  --args="systemd.unified_cgroup_hierarchy=1"
sudo grubby --info="/boot/vmlinuz-$(uname -r)"
sudo reboot
```

Reboot disconnects SSH and interrupts all workloads. After reconnecting:

```bash
stat -fc %T /sys/fs/cgroup
cat /sys/fs/cgroup/cgroup.controllers
```

Expect `cgroup2fs` and controllers including CPU, memory and PIDs. If not,
inspect the active kernel and boot parameters before installing K3s.

## 3. Download installation files on a connected preparation host

Choose the target architecture, regardless of the preparation host's architecture:

```bash
VERSION='v1.33.5+k3s1'
ARCH=arm64
# For x86_64 target nodes, use ARCH=amd64 instead.
mkdir -p "k3s-install/$VERSION/$ARCH"
cd "k3s-install/$VERSION/$ARCH"
BASE="https://github.com/k3s-io/k3s/releases/download/$VERSION"
if [ "$ARCH" = arm64 ]; then BINARY=k3s-arm64; else BINARY=k3s; fi
curl -fL "$BASE/$BINARY" -o "$BINARY"
curl -fL "$BASE/k3s-airgap-images-$ARCH.tar.zst" -o "k3s-airgap-images-$ARCH.tar.zst"
curl -fL "$BASE/sha256sum-$ARCH.txt" -o "sha256sum-$ARCH.txt"
curl -fL https://get.k3s.io -o install.sh
grep -E "[[:space:]](\./)?($BINARY|k3s-airgap-images-$ARCH.tar.zst)$" \
  "sha256sum-$ARCH.txt" > selected.sha256
test "$(wc -l < selected.sha256)" -eq 2
sha256sum -c selected.sha256
sha256sum "$BINARY" "k3s-airgap-images-$ARCH.tar.zst" install.sh > SHA256SUMS
```

Review and archive the downloaded installer script alongside the release files;
`get.k3s.io` is not version-pinned, so recording it makes subsequent installs
reproducible. Official release checksums verify binary/image archives; the local
SHA256SUMS detects transfer changes, including to the reviewed installer.
Transfer this directory and any required OS/SELinux packages to every node.
These system images are separate from application `dependency-images.tar`.

## 4. Stage files on every target node

In the received installation directory (select the actual architecture):

```bash
ARCH=arm64
sha256sum -c SHA256SUMS
if [ "$ARCH" = arm64 ]; then BINARY=k3s-arm64; else BINARY=k3s; fi
sudo install -m 0755 "$BINARY" /usr/local/bin/k3s
sudo mkdir -p /var/lib/rancher/k3s/agent/images /etc/rancher/k3s
sudo cp "k3s-airgap-images-$ARCH.tar.zst" /var/lib/rancher/k3s/agent/images/
/usr/local/bin/k3s --version
```

Expect `v1.33.5+k3s1`. Keep the bundled containerd; Docker is not required.
Even when applications come from Zot, this manual uses the air-gap archive
to bootstrap matching K3s system images without public Internet access.

If using Zot, install the site's reviewed `/etc/rancher/k3s/registries.yaml`
and CA/authentication settings now on every node. See the Registry alternative
in the [K3s Registry guide](https://docs.k3s.io/installation/private-registry). Docker daemon settings do not
configure K3s containerd. Do not publish credentials in Git or public packages.

## 5. Install the server

On the chosen server, create `/etc/rancher/k3s/config.yaml` using this example,
replacing `server-01` and `k3s-api.example.com` with actual values. The TLS SAN
must match a name/IP that remote administrators will use; it does not create DNS.

```yaml
node-name: server-01
write-kubeconfig-mode: "0600"
disable:
  - traefik
tls-san:
  - k3s-api.example.com
```

From the received installer directory, install the service without downloading:

```bash
sudo env INSTALL_K3S_SKIP_DOWNLOAD=true \
  INSTALL_K3S_VERSION='v1.33.5+k3s1' \
  sh ./install.sh server
sudo systemctl status k3s -l --no-pager
sudo journalctl -u k3s -n 100 --no-pager
sudo k3s kubectl get --raw='/readyz?verbose'
sudo k3s kubectl get nodes -o wide
```

The installer enables startup on reboot. Initial air-gap image import can take
time; wait for readiness rather than repeatedly restarting. The default single
server uses a local datastore; application PostgreSQL/UmaDB are installed later
and are not the Kubernetes control-plane database. No extra agent is required
for a single-server deployment. This is not an HA installation.

## 6. Join optional agent nodes

On the server, obtain the join token and transfer it securely:

```bash
sudo cat /var/lib/rancher/k3s/server/node-token
```

On each agent, first complete sections 2-4. Create its own
`/etc/rancher/k3s/config.yaml` with actual values:

```yaml
server: https://k3s-api.example.com:6443
token: "<join-token-from-this-cluster>"
node-name: worker-01
```

Use the server's reachable private address/DNS, not `localhost`. Each agent
needs a distinct node name. Protect the token-bearing configuration:

```bash
sudo chmod 600 /etc/rancher/k3s/config.yaml
sudo env INSTALL_K3S_SKIP_DOWNLOAD=true \
  INSTALL_K3S_VERSION='v1.33.5+k3s1' \
  sh ./install.sh agent
sudo systemctl status k3s-agent -l --no-pager
sudo journalctl -u k3s-agent -n 100 --no-pager
```

Check registration from the server using `sudo k3s kubectl get nodes -o wide`.
A K3s agent is a Kubernetes worker, not an application service or a business
runtime process. Applications are deployed in subsequent steps.

## 7. Configure kubectl and validate the cluster

On the server, use the explicit kubeconfig to avoid stale contexts:

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
kubectl get nodes -o wide
kubectl -n kube-system get pods -o wide
kubectl -n kube-system rollout status deployment/coredns --timeout=180s
kubectl -n kube-system rollout status deployment/local-path-provisioner --timeout=180s
kubectl get storageclass
```

Use root or a securely copied kubeconfig readable only by its owner. This is
cluster-admin access. On another administration machine, securely copy it and
replace only `server: https://127.0.0.1:6443` with the server address covered by
the TLS SAN. A context named `default` is normal for native K3s; do not switch
to a k3d context. Never distribute the administrator kubeconfig to ordinary users.

All intended nodes should be Ready, CoreDNS/local-path-provisioner should be
running, and the default local-path StorageClass should exist. A node being
Ready alone does not prove PVC provisioning or application networking works.
Continue with [application deployment](README.md) or the generated
`environments/<environment>/single-node/README.md` for a combined topology.
Host mounts, workload labels, application Secrets and scheduler permissions
are separate deployment concerns; this installation does not create them.

## 8. Troubleshooting without deleting data

```bash
sudo systemctl show k3s -p ActiveState -p SubState -p NRestarts -p ExecMainStatus
sudo journalctl -u k3s -n 200 --no-pager
sudo ss -lntp | grep ':6443'
sudo k3s kubectl --request-timeout=10s get --raw='/readyz?verbose'
df -h /var/lib/rancher/k3s
df -i /var/lib/rancher/k3s
```

On agents inspect `k3s-agent` instead. Connection refused means the selected
API endpoint is not accepting connections; check the address and server process.
503 means the entry point is reachable but not serving that request yet. Find
the first fatal error rather than treating shutdown-related `kine.sock` warnings
as proof of database corruption. A cgroup-v1 rejection requires checking the
installed version/config and host mode. ImagePullBackOff requires inspecting
Pod events, exact image tags/architecture and node-side Registry configuration.
Do not disable the firewall globally or delete cluster state as a first response.

## References

- [Pinned K3s release](https://github.com/k3s-io/k3s/releases/tag/v1.33.5%2Bk3s1)
- [K3s air-gap installation](https://docs.k3s.io/installation/airgap)
- [K3s quick start and node joining](https://docs.k3s.io/quick-start)
- [K3s requirements and network ports](https://docs.k3s.io/installation/requirements)
- [K3s Registry configuration](https://docs.k3s.io/installation/private-registry)
- [Kubernetes cgroup v2](https://kubernetes.io/docs/concepts/architecture/cgroups/)

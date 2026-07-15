#!/usr/bin/env bash
# 构建期(root)装 mempal:在模板内用 crates.io 官方源编译,glibc ABI 与运行时天然一致,
# 不需要 host 侧 docker 交叉编译。编译副产物(rustup toolchain、cargo registry)有 GB 级,
# 装完即删,镜像里只留 /usr/local/bin/mempal。
set -euo pipefail

mempal_version="${1:?usage: install-mempal.sh <mempal-version>}"

export CARGO_HOME=/root/.cargo RUSTUP_HOME=/root/.rustup
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
. "$CARGO_HOME/env"
cargo install mempal --version "$mempal_version" --locked
install -m 0755 /root/.cargo/bin/mempal /usr/local/bin/mempal
rm -rf /root/.rustup /root/.cargo
mempal --help >/dev/null

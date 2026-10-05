#!/bin/sh
# Builds the codec oracle (tools/swift/oracle) from ImageMarkupKit's UIKit-free model sources.
# Usage: tools/swift/build-oracle.sh [checkout]
#   checkout  an ImageMarkupKit checkout; by default the public repository is cloned at tag 0.2.0 into a
#             temporary folder.
# Output: .cache/swift-oracle/oracle
set -eu
cd "$(dirname "$0")/../.."
output=.cache/swift-oracle
mkdir -p "$output"
if [ $# -ge 1 ]; then
  sources="$1/Sources/ImageMarkupKit"
else
  clone=$(mktemp -d)
  trap 'rm -rf "$clone"' EXIT
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch 0.2.0 https://github.com/thnhsng/ImageMarkupKit.git "$clone"
  sources="$clone/Sources/ImageMarkupKit"
fi
swiftc -O -swift-version 5 -o "$output/oracle" \
  "$sources/Model/MarkupDocument.swift" \
  "$sources/Model/MarkupItem.swift" \
  "$sources/Model/ItemContents.swift" \
  "$sources/Model/ItemStyle.swift" \
  "$sources/Editor/Tool.swift" \
  "$sources/Public/MarkupFeatures.swift" \
  tools/swift/oracle/main.swift
echo "built $output/oracle"

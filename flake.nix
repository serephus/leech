{
  description = "leech: LeetCode sync GitHub Action — development shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { self, nixpkgs, utils }:
    utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            pnpm
          ];
          shellHook = ''
            echo "leech dev shell: node $(node --version) / pnpm $(pnpm --version)"
          '';
        };
      }
    );
}

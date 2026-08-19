{
  description = "leech: LeetCode sync GitHub Action — CLI package and development shell";

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
        version = (builtins.fromJSON (builtins.readFile ./package.json)).version;
        src = self;
      in
      {
        packages.default = pkgs.stdenv.mkDerivation {
          pname = "leech";
          inherit version src;

          nativeBuildInputs = [
            pkgs.makeWrapper
            pkgs.nodejs_24
            pkgs.pnpm
            pkgs.pnpmConfigHook
          ];

          pnpmDeps = pkgs.fetchPnpmDeps {
            pname = "leech";
            inherit version src;
            fetcherVersion = 4;
            hash = "sha256-V/qWt6Nwy1nGJiRFWaFnHlh06FTqHlqsvNqttPdDioE=";
          };

          buildPhase = ''
            runHook preBuild
            pnpm build
            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall
            mkdir -p $out/lib/node_modules/leech $out/bin
            cp -r dist $out/lib/node_modules/leech/
            makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/leech \
              --add-flags $out/lib/node_modules/leech/dist/cli.js
            runHook postInstall
          '';

          meta = {
            description = "Sync LeetCode submissions to a git repository (CLI)";
            license = {
              fullName = "GLWT (Good Luck With That) Public License";
              shortName = "GLWTPL";
              url = "https://github.com/me-shaon/GLWTPL";
            };
            mainProgram = "leech";
          };
        };

        apps.default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/leech";
        };

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

{
  description = "mc-render: Rendering and input handling for a Minecraft clone.";

  inputs = {
    # flake.lock pins nixpkgs. Before updating it, confirm the candidate
    # oxlint version passes pnpm verify with the current lint configuration.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # CI uses x86_64-linux; local development uses aarch64-darwin.
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          # CI and release workflows use Node 26; package.json keeps its
          # minimum at Node 24. Match CI here. The nixpkgs Corepack package
          # defaults to Node 24, so override its runtime to Node 26 as well.
          # Keep developer tools in nixpkgs so flake.lock pins their versions.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_26
              (pkgs.corepack.override { nodejs-slim = pkgs.nodejs-slim_26; })
              pkgs.typescript-language-server
              pkgs.oxlint
              pkgs.ast-grep
            ];

            shellHook = ''
              # Corepack's default shim location is inside the read-only Nix store.
              # Install its shims in a temporary writable directory instead.
              corepackDir="$(mktemp -d "''${TMPDIR:-/tmp}/mc-render-corepack.XXXXXX")"
              corepack enable --install-directory "$corepackDir"
              export PATH="$corepackDir:$PATH"
            '';
          };
        }
      );
    };
}

{
  description = "mc-render: Rendering and input handling for a Minecraft clone.";

  inputs = {
    # nixos-unstable, not nixpkgs-unstable: it advances only after the NixOS
    # release tests pass, so it is less likely to land a broken build.
    #
    # flake.lock pins nixpkgs to 624af66541 across the org; it supplies
    # oxlint 1.75.0, which passes pnpm verify with the active lint config.
    # Keep that version because oxlint >=1.79.0 false-positives in
    # no-redeclare on the `type X = ... & Brand` plus `const X = ...` idiom
    # using `Brand.refined`. The false positive persists with oxlint 1.88
    # after changing the constructor to `Brand.make`. See DEPENDENCY_POLICY.md
    # §5's "前提条件" note. Recheck the candidate oxlint with pnpm verify
    # before changing the pin.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # CI exercises x86_64-linux; local development uses aarch64-darwin.
      # Keep the list to supported systems because `nix flake check
      # --all-systems` checks every declared system and fails if outputs
      # cannot build there.
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
          # Node 26 matches CI and release; this package and its mc-*
          # dependencies keep their Node 24 minimum. pnpm comes from Corepack
          # so packageManager in package.json selects its version instead of
          # a second nixpkgs pnpm pin. nixpkgs Corepack defaults to Node 24,
          # so override its runtime to Node 26 too.
          #
          # Keep developer tools in nixpkgs so flake.lock pins their versions.
          # oxlint is not a package.json devDependency. It used to be, and
          # repositories across the org independently drifted to different
          # npm versions without noticing because a filename bug kept
          # `.oxlintrc.json` from loading. See DEPENDENCY_POLICY.md §5's
          # "前提条件" note. With that bug fixed, one nixpkgs-pinned oxlint
          # version is shared instead of independent npm pins.
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

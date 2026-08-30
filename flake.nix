{
  description = "mc-render: Rendering and runtime input for the nerima-games Minecraft-clone rebuild: the post-processing chain, material policy, per-frame scratch buffers, and the InputService.";

  inputs = {
    # nixos-unstable, not nixpkgs-unstable: it advances only after the NixOS
    # release tests pass, so it is less likely to land a broken build.
    #
    # flake.lock is pinned (via `nix flake lock --override-input nixpkgs
    # github:NixOS/nixpkgs/624af665...`, not `nix flake update`) to a specific
    # revision, org-wide, as of Wave 0: the nixos-unstable head at the time
    # shipped oxlint >=1.79.0, whose no-redeclare rule false-positives on the
    # `type X = ... & Brand` + `const X = Brand.refined` idiom used across
    # this repository's domain/ types (A/B-tested against 1.75.0, which is
    # clean). Re-check on the next nixpkgs bump.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # Only what is actually exercised: x86_64-linux by CI, aarch64-darwin by
      # the maintainer. Declaring a platform nothing builds makes
      # `nix flake check --all-systems` fail rather than skip it.
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
          # Node 24 matches the `engines` fields of the mc-* dependencies and
          # the package itself. pnpm comes
          # from corepack rather than nixpkgs so that the version is decided by
          # the `packageManager` field in package.json — one source of truth
          # instead of two that can drift.
          #
          # oxlint is the opposite case: it is NOT a package.json devDependency.
          # It used to be, and every repo in the org independently drifted onto
          # a different version (some on 0.12.x, some on 1.7x.x) without anyone
          # noticing, because the config file (`.oxlintrc.json`) had a filename
          # bug that meant it was never actually being loaded either way — see
          # DEPENDENCY_POLICY.md §5's "前提条件" note. Once that bug was fixed,
          # a single pinned Nix-provided oxlint became the one source of truth
          # instead of 16 independently-drifting npm pins.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_24
              pkgs.corepack_24
              pkgs.typescript-language-server
              pkgs.oxlint
              pkgs.ast-grep
            ];

            shellHook = ''
              corepackDir="$(mktemp -d "''${TMPDIR:-/tmp}/mc-render-corepack.XXXXXX")"
              corepack enable --install-directory "$corepackDir"
              export PATH="$corepackDir:$PATH"
            '';
          };
        }
      );
    };
}

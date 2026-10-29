# Grove

This is a public open-source project. Never commit anything specific to the
maintainer's machine or work: no names of private repositories, organisations,
branches or people, no home folders, usernames, distro names, emails or session
links. Use made-up examples (e.g. `\\wsl.localhost\Ubuntu\home\user\src\example`)
in code, tests, fixtures, scripts and docs.

- Test fixtures come from throwaway repositories built by
  `scripts/make-fixtures.sh`; add new cases there rather than capturing output
  from a real repository.
- To try the app against a real repository, pass it at run time
  (`scripts/test-run.ps1 -Repo <path>`, the `WV_*` environment variables), never
  in a committed file.
- Commit messages follow the same rule.

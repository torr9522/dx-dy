# Caddy Reconciliation And Rollback Research

## Incident

The public v0.3.7 Manager correctly discovered the Staging main configuration
at `/etc/caddy/Caddyfile` and its separately imported dx-dy fragment. The new
runtime started, but reconciliation replaced the customized fragment with the
release template. The main configuration had `auto_https off`; the customized
fragment explicitly retained its HTTPS certificate automation policy. The
release template did not. Caddy accepted and loaded the resulting configuration,
but public HTTPS health did not recover, so the update entered rollback.

Rollback restored the previous release, database and fragment bytes. It then
called public Caddy health while `dx-dy.service` was still stopped. That check
could only return 502, causing rollback to stop before restarting the restored
application.

## Evidence

- Caddy's global options documentation states that `auto_https off` disables
  certificate management and redirects, while the default protocol remains
  HTTPS.
- Caddy's automatic HTTPS documentation states that automatic HTTPS augments
  rather than overrides explicit configuration.
- The TLS directive documentation describes explicit certificate automation.
- Staging Caddy logs showed `automatic HTTPS is completely disabled` immediately
  after v0.3.7 reconciliation, followed by the 30-second public-health timeout.
- The restored fragment hash exactly matched its pre-update hash, and Caddy
  reload succeeded. Subsequent public health requests failed with connection
  refused because port 3001 remained stopped.
- The v0.3.7 test fixture always returned successful public health regardless of
  service state, so it did not model the rollback ordering dependency.

## Design

The Manager renders both the old and new release templates. It may atomically
replace the active fragment only when that fragment is byte-identical to the old
release's rendered template. A fragment that differs is treated as customized:
the Manager validates the complete main configuration with the new candidate,
preserves the active fragment byte-for-byte, performs no reload, and requires
both public hosts to remain healthy with the new runtime.

Fragment restoration now performs only the atomic file restore, complete-config
validation and graceful reload. Rollback then starts the restored application
before checking internal and public health. This separates configuration
recovery from end-to-end application availability while retaining fail-closed
behavior.

## Compatibility

This design does not parse or rewrite operator TLS directives, certificate file
paths, global options or unrelated site blocks. Release-managed fragments keep
the existing atomic reconciliation behavior. Customized fragments retain their
exact bytes. Caddy 2.6.2 and current Staging Caddy are exercised with isolated
official binaries; neither server Caddy installation is upgraded.

## Official Sources

- Caddy automatic HTTPS: https://caddyserver.com/docs/automatic-https
- Caddy global `auto_https` option: https://caddyserver.com/docs/caddyfile/options#auto-https
- Caddy `tls` directive: https://caddyserver.com/docs/caddyfile/directives/tls
- Caddy command-line `validate` and `reload`: https://caddyserver.com/docs/command-line
- Caddy v2.6.2 source: https://github.com/caddyserver/caddy/tree/v2.6.2
- Caddy current repository: https://github.com/caddyserver/caddy
- systemd service state and ordering: https://www.freedesktop.org/software/systemd/man/latest/systemctl.html

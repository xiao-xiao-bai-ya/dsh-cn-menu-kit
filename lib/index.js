/**
 * dsh-cn-menu-kit — host half.
 *
 * The actual feature lives entirely in the client half (lib/client.js): the
 * browser already receives every skill's name + description through the
 * official `skills/list` remote, and this plugin's Chinese titles ride in the
 * description's leading 「标题——」 segment written by the description pass.
 *
 * The host half exists because a bundle patch must insert at least one
 * service row for the bundle to join the composition the same way other
 * client plugins (skill-explorer, dsh-reference-anything) do. It is a
 * deliberate no-op beyond a readiness log line.
 */
const name = 'cn-menu-kit';
const inject = [];

function apply(ctx) {
    try {
        ctx.logger?.info?.('dsh-cn-menu-kit: host ready — / 源由客户端注册');
    } catch {
        /* logger absence is fine */
    }
}

export { name, inject, apply };

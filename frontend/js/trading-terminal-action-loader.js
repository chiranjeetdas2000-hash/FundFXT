/* ============================================================
   FUNDFXT MOBILE TRADING ACTION LOADER
   ------------------------------------------------------------
   Only user-initiated trading mutations use the blocking loader.
   Read-only quote, trade-list, and pending-list requests stay
   non-blocking so background refreshes cannot trap the screen.
   ============================================================ */

(() => {
    'use strict';

    const mobile = () => {
        return window.matchMedia(
            '(max-width: 768px)',
        ).matches;
    };

    const getActionMessage = (
        method,
        pathname,
    ) => {
        if (
            method === 'POST'
            && pathname.endsWith('/partial-close')
        ) {
            return 'Partial Closing...';
        }

        if (
            method === 'POST'
            && pathname.endsWith('/close')
        ) {
            return 'Closing Position...';
        }

        if (
            method === 'PATCH'
            && pathname.startsWith('/api/trades/')
        ) {
            return 'Modifying Position...';
        }

        if (
            method === 'DELETE'
            && pathname.startsWith('/api/trades/')
        ) {
            return 'Cancelling Pending Order...';
        }

        return null;
    };

    const originalFetch = window.fetch.bind(
        window,
    );

    window.fetch = async (
        input,
        init = {},
    ) => {
        const request = new Request(
            input,
            init,
        );

        const url = new URL(
            request.url,
            window.location.href,
        );

        const method = request.method.toUpperCase();

        const message = getActionMessage(
            method,
            url.pathname,
        );

        if (
            !message
            || typeof window.executeWithLoader !== 'function'
            || !mobile()
        ) {
            return originalFetch(
                input,
                init,
            );
        }

        return window.executeWithLoader(
            () => originalFetch(
                input,
                init,
            ),
            message,
        );
    };
})();

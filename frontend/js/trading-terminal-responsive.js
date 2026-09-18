(() => {
    'use strict';

    const shell = document.getElementById(
        'terminalShell',
    );

    if (!shell) {
        return;
    }

    const compact = () =>
        matchMedia(
            '(max-width:1100px),(max-aspect-ratio:1/1)',
        ).matches;

    function sync() {
        if (!compact()) {
            shell.classList.remove(
                'mobile-pairs',
                'mobile-chart',
                'mobile-trades',
            );

            return;
        }

        if (
            !shell.classList.contains('mobile-pairs')
            && !shell.classList.contains('mobile-chart')
            && !shell.classList.contains('mobile-trades')
        ) {
            shell.classList.add(
                'mobile-pairs',
            );
        }
    }

    sync();

    window.addEventListener(
        'resize',
        sync,
    );
})();

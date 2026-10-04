(function () {
    "use strict";

    function showServerBusyPopup() {
        const popup = document.getElementById("serverBusyPopup");

        if (!popup) {
            return;
        }

        popup.hidden = false;

        clearTimeout(window.__serverBusyTimer);

        window.__serverBusyTimer = setTimeout(function () {
            popup.hidden = true;
        }, 5000);
    }

    function hideServerBusyPopup() {
        const popup = document.getElementById("serverBusyPopup");

        if (!popup) {
            return;
        }

        popup.hidden = true;
    }

    window.showServerBusyPopup = showServerBusyPopup;
    window.hideServerBusyPopup = hideServerBusyPopup;

    const originalFetch = window.fetch;

    window.fetch = async function () {
        const response = await originalFetch.apply(this, arguments);

        if (response.status === 429) {
            try {
                const cloned = response.clone();
                const body = await cloned.json();

                if (body && body.error === "SERVER_BUSY") {
                    showServerBusyPopup();
                }
            } catch (err) {
                // Not JSON, ignore.
            }
        }

        return response;
    };
})();

(() => {
  const checkout = document.querySelector("[data-checkout]");
  const status = document.querySelector("#payment-status");
  const payment = document.querySelector("#payment-details");
  const countdown = document.querySelector("#payment-countdown");
  const refreshError = document.querySelector("#payment-refresh-error");
  const copy = document.querySelector("#copy-address");
  const address = document.querySelector("#payment-address");
  const expires = Date.parse(checkout.dataset.expiresAt);
  let payable = checkout.dataset.payable === "true";

  function updateCountdown() {
    const seconds = Math.max(0, Math.ceil((expires - Date.now()) / 1000));
    payment.hidden = !payable || seconds === 0;
    const minutes = Math.floor(seconds / 60);
    countdown.textContent = `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  }

  async function refresh() {
    try {
      const response = await fetch(checkout.dataset.statusUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const current = await response.json();
      if (status.textContent !== current.message) status.textContent = current.message;
      status.className = `badge ${current.badge}`;
      payable = current.payable;
      refreshError.hidden = true;
      updateCountdown();
    } catch (error) {
      refreshError.hidden = false;
    } finally {
      window.setTimeout(refresh, 4000);
    }
  }

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(address.value);
      copy.textContent = "Copied";
    } catch (error) {
      address.focus();
      address.select();
      copy.textContent = "Selected";
    }
  });

  updateCountdown();
  window.setInterval(updateCountdown, 1000);
  window.setTimeout(refresh, 4000);
})();

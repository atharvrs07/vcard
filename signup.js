(function () {
  "use strict";

  var mode = "signup";
  var form = document.getElementById("auth-form");
  var nameInput = document.getElementById("name");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var otpInput = document.getElementById("otp");
  var otpWrap = document.getElementById("otp-wrap");
  var sendOtpBtn = document.getElementById("send-otp-btn");
  var submitBtn = document.getElementById("submit-btn");
  var toggleBtn = document.getElementById("toggle-mode");
  var msg = document.getElementById("auth-message");
  var titleEl = document.getElementById("auth-title");
  var subtitleEl = document.getElementById("auth-subtitle");

  function showMessage(text, ok) {
    msg.textContent = text;
    msg.style.display = "block";
    msg.className = "alert " + (ok ? "alert-success" : "alert-danger");
  }

  function setMode(next) {
    mode = next;
    if (mode === "signup") {
      if (titleEl) titleEl.textContent = "Create your account";
      if (subtitleEl) subtitleEl.textContent = "Sign up first so your card is saved in your account and never gets lost.";
      submitBtn.textContent = "Create account";
      toggleBtn.textContent = "Already have an account? Log in";
      nameInput.required = true;
      nameInput.parentElement.style.display = "";
      if (otpWrap) otpWrap.style.display = "";
      if (otpInput) otpInput.required = true;
      passwordInput.autocomplete = "new-password";
    } else {
      if (titleEl) titleEl.textContent = "Log in to your account";
      if (subtitleEl) subtitleEl.textContent = "Continue where you left off. Your published cards stay saved in your account.";
      submitBtn.textContent = "Log in";
      toggleBtn.textContent = "New here? Create account";
      nameInput.required = false;
      nameInput.parentElement.style.display = "none";
      if (otpWrap) otpWrap.style.display = "none";
      if (otpInput) otpInput.required = false;
      passwordInput.autocomplete = "current-password";
    }
    msg.style.display = "none";
  }

  function submitAuth(ev) {
    ev.preventDefault();
    var payload = {
      email: emailInput.value.trim(),
      password: passwordInput.value,
    };
    if (mode === "signup") {
      payload.name = nameInput.value.trim();
      payload.otp = (otpInput && otpInput.value.trim()) || "";
    }

    submitBtn.disabled = true;
    fetch(mode === "signup" ? "/auth/signup" : "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return {};
        }).then(function (data) {
          if (!r.ok) throw new Error(data.error || "Could not continue");
          return data;
        });
      })
      .then(function () {
        window.location.href = "/dashboard";
      })
      .catch(function (e) {
        showMessage(e.message || "Could not continue", false);
      })
      .finally(function () {
        submitBtn.disabled = false;
      });
  }

  function sendOtp() {
    if (mode !== "signup") return;
    var name = nameInput.value.trim();
    var email = emailInput.value.trim();
    if (!name) {
      showMessage("Enter your full name first.", false);
      return;
    }
    if (!email) {
      showMessage("Enter your email first.", false);
      return;
    }
    sendOtpBtn.disabled = true;
    fetch("/auth/send-signup-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, email: email }),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return {};
        }).then(function (data) {
          if (!r.ok) throw new Error(data.error || "Could not send OTP");
          return data;
        });
      })
      .then(function () {
        showMessage("OTP sent to your email. It is valid for 10 minutes.", true);
      })
      .catch(function (e) {
        showMessage(e.message || "Could not send OTP", false);
      })
      .finally(function () {
        sendOtpBtn.disabled = false;
      });
  }

  toggleBtn.addEventListener("click", function () {
    setMode(mode === "signup" ? "login" : "signup");
  });
  if (sendOtpBtn) sendOtpBtn.addEventListener("click", sendOtp);
  form.addEventListener("submit", submitAuth);

  fetch("/auth/me")
    .then(function (r) {
      if (!r.ok) return null;
      return r.json();
    })
    .then(function (data) {
      if (data && data.authenticated) {
        window.location.href = "/dashboard";
      }
    })
    .catch(function () {});

  if (window.location.pathname.toLowerCase() === "/login") setMode("login");
  else setMode("signup");
})();

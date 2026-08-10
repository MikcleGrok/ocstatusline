class Ocstatusline < Formula
  desc "Live, customizable status line for OpenCode (single-binary push daemon)"
  homepage "https://github.com/MikcleGrok/ocstatusline"
  version "0.2.6"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-darwin-arm64"
      sha256 "1b6a8a06535b9cad4d22059919ea8af18a80295c26e92e03a9d675b090e3525f"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-darwin-x64"
      sha256 "6510c2e5fdbcbe02a208dd99da800f44786d5db7bb9e326f2286b037c0bc8cfb"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-linux-arm64"
      sha256 "e568368bcacc65cf732fc35d695b688b313f7e46b36d0ed50473aa4b132297f9"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-linux-x64"
      sha256 "573f1a9c62b2161344eea8569446041b8be337feec98381ac0f903fbe073f025"
    end
  end

  def install
    arch = Hardware::CPU.arm? ? "arm64" : "x64"
    bin.install "ocstatusline-#{OS.kernel_name}-#{arch}" => "ocstatusline"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/ocstatusline --version")
  end
end

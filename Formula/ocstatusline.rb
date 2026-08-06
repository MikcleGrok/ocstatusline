class Ocstatusline < Formula
  desc "Live, customizable status line for OpenCode (single-binary push daemon)"
  homepage "https://github.com/MikcleGrok/ocstatusline"
  version "0.2.4"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-darwin-arm64"
      sha256 "3c282cc69ecc560c9a8fcc54dcc59a3233613812e182684498b3ef5f264d972e"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-darwin-x64"
      sha256 "bd383bd884f43c0029b152baab6246e72f1cdb7fbe02c2c698c3d70bc4a16848"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-linux-arm64"
      sha256 "0e42c8c94b8922d3bbaa6e04399cbd56b973312aba39d09957adee66af1259ca"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-linux-x64"
      sha256 "0dcb4b2716134593c460c924c733449618a37c8c0bd50f9a5902a3e09d3fe3cf"
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

class Ocstatusline < Formula
  desc "Live, customizable status line for OpenCode (single-binary push daemon)"
  homepage "https://github.com/MikcleGrok/ocstatusline"
  version "0.2.8"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-darwin-arm64"
      sha256 "ca3bf2a5625a8be3b74491149daa2ba6a0f923fe7da0cfa7c4057525d188d4e7"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-darwin-x64"
      sha256 "3980052430d5798897e6ea32e54447fd5776442a92206f5b20c31d871f30a17f"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-linux-arm64"
      sha256 "ab736f4ce42c91ce4253aa6b7c78f5fcdf49c2a383dea989b2b4a456d3fc74d8"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-linux-x64"
      sha256 "0f4460682ecd477364df34b01915db3a1f48d1c70f8bf1d8b2a763b6842db9a7"
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

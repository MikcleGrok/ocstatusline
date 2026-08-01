class Ocstatusline < Formula
  desc "Live, customizable status line for OpenCode (single-binary push daemon)"
  homepage "https://github.com/MikcleGrok/ocstatusline"
  version "0.2.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-darwin-arm64"
      sha256 "b3a5c79d74ad96b972f99db1ee9180984b1520fd2aeadd4df4831498b32067e5"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-darwin-x64"
      sha256 "19d7819cb9c6f9dcd9ccb5389f2a915c612ebdba41f535a5b4e5ec4610be02c5"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-linux-arm64"
      sha256 "010f4a30c2605978f801f6e551365ca8b46a8f7be0e835adc6d7c02b37f8d15e"
    else
      url "https://github.com/MikcleGrok/ocstatusline/releases/download/v#{version}/ocstatusline-linux-x64"
      sha256 "379834a5aeb522404c9a3b989750449a87e735329ba0d9322bb93798a042a5d0"
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

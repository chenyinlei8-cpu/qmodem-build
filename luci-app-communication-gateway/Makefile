include $(TOPDIR)/rules.mk

LUCI_TITLE:=Unified Communication Gateway
LUCI_DESCRIPTION:=Single LuCI page for modem, SIP, WAN, Tailscale and USB audio status
LUCI_DEPENDS:=+luci-base +qmodem +socat
LUCI_PKGARCH:=all

define Build/Prepare/luci-app-communication-gateway
	chmod 0755 $(PKG_BUILD_DIR)/root/usr/libexec/rpcd/communication_gateway
endef

include $(TOPDIR)/feeds/luci/luci.mk

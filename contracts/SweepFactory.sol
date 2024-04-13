// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

contract DepositSweeper {
    error Unauthorized();
    error TransferFailed();

    address private immutable factory = msg.sender;

    receive() external payable {}

    function send(address token, address recipient, uint256 amount, bool all) external {
        if (msg.sender != factory) revert Unauthorized();

        if (token == address(0)) {
            uint256 value = all ? address(this).balance : amount;
            if (value == 0) return;
            (bool ok, ) = recipient.call{value: value}("");
            if (!ok) revert TransferFailed();
        } else {
            if (token.code.length == 0) revert TransferFailed();
            uint256 value = all ? IERC20(token).balanceOf(address(this)) : amount;
            if (value == 0) return;
            (bool ok, bytes memory result) = token.call(
                abi.encodeCall(IERC20.transfer, (recipient, value))
            );
            if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) {
                revert TransferFailed();
            }
        }
    }
}

contract SweepFactory {
    error Unauthorized();
    error InvalidTransfer();

    struct Sweep {
        bytes32 invoiceId;
        address token;
    }

    struct Refund {
        bytes32 invoiceId;
        bytes32 transferId;
        address token;
        address recipient;
        uint256 amount;
    }

    mapping(bytes32 => bool) public refunded;

    modifier onlyTreasury(address treasury) {
        if (msg.sender != treasury) revert Unauthorized();
        _;
    }

    function initCodeHash() public pure returns (bytes32) {
        return keccak256(type(DepositSweeper).creationCode);
    }

    function depositAddress(address treasury, bytes32 invoiceId) public view returns (address) {
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), salt(treasury, invoiceId), initCodeHash())
        );
        return address(uint160(uint256(hash)));
    }

    function deployAndSweepETH(address treasury, bytes32 invoiceId) external onlyTreasury(treasury) {
        getSweeper(treasury, invoiceId).send(address(0), treasury, 0, true);
    }

    function deployAndSweepERC20(address treasury, bytes32 invoiceId, address token)
        external onlyTreasury(treasury)
    {
        if (token == address(0)) revert InvalidTransfer();
        getSweeper(treasury, invoiceId).send(token, treasury, 0, true);
    }

    function batchSweep(address treasury, Sweep[] calldata items) external onlyTreasury(treasury) {
        for (uint256 i; i < items.length; ++i) {
            getSweeper(treasury, items[i].invoiceId).send(items[i].token, treasury, 0, true);
        }
    }

    function batchRefund(address treasury, Refund[] calldata items) external onlyTreasury(treasury) {
        for (uint256 i; i < items.length; ++i) {
            Refund calldata item = items[i];
            if (item.amount == 0 || item.recipient == address(0)) revert InvalidTransfer();
            bytes32 key = keccak256(abi.encode(salt(treasury, item.invoiceId), item.transferId));
            if (refunded[key]) revert InvalidTransfer();
            refunded[key] = true;
            getSweeper(treasury, item.invoiceId).send(item.token, item.recipient, item.amount, false);
        }
    }

    function salt(address treasury, bytes32 invoiceId) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(treasury, invoiceId));
    }

    function getSweeper(address treasury, bytes32 invoiceId) private returns (DepositSweeper) {
        address deposit = depositAddress(treasury, invoiceId);
        if (deposit.code.length == 0) return new DepositSweeper{salt: salt(treasury, invoiceId)}();
        return DepositSweeper(payable(deposit));
    }
}
